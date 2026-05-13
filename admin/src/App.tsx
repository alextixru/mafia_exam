import { useCallback, useEffect, useMemo, useState } from "react";
import {
  parsePoll,
  type Poll,
  type PollId,
  type Question,
  type QuestionId,
} from "@shared/poll-schema.ts";
import {
  deletePoll as apiDelete,
  fetchPolls,
  logout,
  savePoll as apiSave,
  type CurrentUser,
} from "./api.ts";
import { PollList } from "./components/PollList.tsx";
import { QuestionEditor } from "./components/QuestionEditor.tsx";
import { QuestionList } from "./components/QuestionList.tsx";
import { Topbar } from "./components/Topbar.tsx";
import { newQuestion } from "./poll-ui.ts";
import { genId, slugifyUnique } from "./utils.ts";

const NEW_POLL_ID = "__new__";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

interface AppProps {
  user: CurrentUser;
}

export default function App({ user }: AppProps) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });

  const [selectedPollId, setSelectedPollId] = useState<PollId | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] =
    useState<QuestionId | null>(null);

  const [draft, setDraft] = useState<Poll | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState({ kind: "loading" });
    try {
      const list = await fetchPolls();
      setPolls(list);
      setSelectedPollId((cur) => cur ?? list[0]?.id ?? null);
      setLoadState({ kind: "ready" });
    } catch (e) {
      setLoadState({ kind: "error", message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // при смене выбранного опроса — пересинхронизируем draft из источника
  useEffect(() => {
    const fresh = polls.find((p) => p.id === selectedPollId) ?? null;
    setDraft(fresh ? structuredClone(fresh) : null);
    setSelectedQuestionId(null);
  }, [selectedPollId, polls]);

  const original = useMemo(
    () => polls.find((p) => p.id === selectedPollId) ?? null,
    [polls, selectedPollId],
  );
  const dirty = useMemo(
    () => !!draft && JSON.stringify(draft) !== JSON.stringify(original),
    [draft, original],
  );

  const updateDraft = (patch: Partial<Poll>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setSaved(false);
  };

  const updateQuestion = (q: Question) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((x) => (x.id === q.id ? q : x)),
          }
        : d,
    );
    setSaved(false);
  };

  const addQuestion = () => {
    if (!draft) return;
    const q = newQuestion("free", genId());
    setDraft({ ...draft, questions: [...draft.questions, q] });
    setSelectedQuestionId(q.id);
    setSaved(false);
  };

  const deleteQuestion = (id: QuestionId) => {
    if (!draft) return;
    setDraft({
      ...draft,
      questions: draft.questions.filter((q) => q.id !== id),
    });
    if (selectedQuestionId === id) setSelectedQuestionId(null);
    setSaved(false);
  };

  const moveQuestion = (id: QuestionId, dir: -1 | 1) => {
    if (!draft) return;
    const idx = draft.questions.findIndex((q) => q.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= draft.questions.length) return;
    const arr = [...draft.questions];
    const tmp = arr[idx]!;
    arr[idx] = arr[next]!;
    arr[next] = tmp;
    setDraft({ ...draft, questions: arr });
    setSaved(false);
  };

  const createPoll = () => {
    const fresh: Poll = {
      id: NEW_POLL_ID,
      title: "Новый опрос",
      description: "",
      questions: [],
    };
    setPolls((ps) => [...ps.filter((p) => p.id !== NEW_POLL_ID), fresh]);
    setSelectedPollId(NEW_POLL_ID);
  };

  const deletePoll = async (id: PollId) => {
    // Новый, ещё не сохранённый опрос — бэк про него не знает.
    if (id !== NEW_POLL_ID) {
      try {
        await apiDelete(id);
      } catch (e) {
        setSaveError((e as Error).message);
        return;
      }
    }
    setPolls((ps) => ps.filter((p) => p.id !== id));
    if (selectedPollId === id) {
      setSelectedPollId(null);
      setDraft(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaveError(null);

    // Для новых опросов генерим стабильный slug из title.
    const finalDraft: Poll =
      draft.id === NEW_POLL_ID
        ? {
            ...draft,
            id: slugifyUnique(
              draft.title,
              polls.map((p) => p.id).filter((id) => id !== NEW_POLL_ID),
            ),
          }
        : draft;

    // pre-flight: гоняем тот же parsePoll, что и сервер, чтобы поймать
    // ошибки локально без round-trip.
    const valid = parsePoll(finalDraft);
    if (!valid.ok) {
      setSaveError(valid.error);
      return;
    }
    setSaving(true);
    try {
      const saved = await apiSave(valid.value);
      setPolls((ps) => {
        // Замещаем либо запись с прежним id, либо маркер "__new__".
        const idx = ps.findIndex(
          (p) => p.id === saved.id || p.id === NEW_POLL_ID,
        );
        if (idx === -1) return [...ps, saved];
        const next = [...ps];
        next[idx] = saved;
        return next;
      });
      setDraft(structuredClone(saved));
      setSelectedPollId(saved.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!original) return;
    setDraft(structuredClone(original));
    setSelectedQuestionId(null);
    setSaved(false);
  };

  const selectedQuestion =
    draft?.questions.find((q) => q.id === selectedQuestionId) ?? null;
  const selectedQuestionIndex = selectedQuestion
    ? (draft?.questions.findIndex((q) => q.id === selectedQuestionId) ?? -1)
    : -1;

  return (
    <div className="min-h-svh bg-dc-bg text-dc-text flex flex-col">
      <Topbar
        dirty={dirty}
        saving={saving}
        saved={saved}
        error={saveError}
        user={user}
        onSave={save}
        onReset={reset}
        onLogout={async () => {
          await logout();
          window.location.reload();
        }}
      />

      {loadState.kind === "loading" && <CenterMessage>Загружаю опросы…</CenterMessage>}

      {loadState.kind === "error" && (
        <CenterMessage>
          <div className="text-dc-red mb-2">Не могу подключиться к боту.</div>
          <div className="text-xs text-dc-mute2 mb-4 font-mono">
            {loadState.message}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm bg-dc-blurple hover:bg-dc-blurple-h rounded-md px-4 py-2 transition"
          >
            Повторить
          </button>
        </CenterMessage>
      )}

      {loadState.kind === "ready" && (
        <div className="flex-1 grid grid-cols-3 gap-px bg-dc-border overflow-hidden">
          <PollList
            polls={polls}
            selectedId={selectedPollId}
            onSelect={setSelectedPollId}
            onCreate={createPoll}
            onDelete={deletePoll}
          />

          {draft ? (
            <>
              <QuestionList
                poll={draft}
                selectedId={selectedQuestionId}
                onSelect={setSelectedQuestionId}
                onAdd={addQuestion}
                onDelete={deleteQuestion}
                onMove={moveQuestion}
                onTitleChange={(title) => updateDraft({ title })}
                onDescriptionChange={(description) =>
                  updateDraft({ description })
                }
              />
              <QuestionEditor
                question={selectedQuestion}
                index={selectedQuestionIndex}
                onChange={updateQuestion}
              />
            </>
          ) : (
            <EmptyState onCreate={createPoll} />
          )}
        </div>
      )}
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-dc-muted text-center px-6">
      <div>{children}</div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="col-span-2 flex items-center justify-center bg-dc-surface-2">
      <div className="text-center space-y-3">
        <div className="text-dc-mute2 text-sm">Опрос не выбран.</div>
        <button
          type="button"
          onClick={onCreate}
          className="text-sm bg-dc-blurple hover:bg-dc-blurple-h text-white rounded-md px-4 py-2 font-medium transition"
        >
          + Создать опрос
        </button>
      </div>
    </div>
  );
}
