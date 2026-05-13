import type { Poll, Question, QuestionId } from "@shared/poll-schema.ts";
import { KIND_LABEL } from "../poll-ui.ts";
import { classNames } from "../utils.ts";

interface Props {
  poll: Poll;
  selectedId: QuestionId | null;
  onSelect: (id: QuestionId) => void;
  onAdd: () => void;
  onDelete: (id: QuestionId) => void;
  onMove: (id: QuestionId, dir: -1 | 1) => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
}

export function QuestionList({
  poll,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
  onMove,
  onTitleChange,
  onDescriptionChange,
}: Props) {
  return (
    <section className="flex flex-col bg-dc-surface-2 min-w-0">
      <div className="px-5 py-4 border-b border-dc-border space-y-3 shrink-0">
        <div>
          <Label>Название</Label>
          <input
            value={poll.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Название опроса"
            className="w-full bg-dc-bg border border-dc-border rounded px-3 py-2 text-base font-medium focus:outline-none focus:border-dc-blurple transition"
          />
          {!poll.id.startsWith("__") && (
            <div className="text-xs font-mono text-dc-mute2 mt-1">{poll.id}</div>
          )}
        </div>
        <div>
          <Label>Описание</Label>
          <textarea
            value={poll.description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Короткое описание (необязательно)"
            rows={2}
            className="w-full bg-dc-bg border border-dc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-dc-blurple transition resize-y"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <Label>Вопросы ({poll.questions.length})</Label>
        </div>

        <div className="space-y-1.5">
          {poll.questions.map((q, i) => (
            <QuestionRow
              key={q.id}
              question={q}
              index={i}
              total={poll.questions.length}
              active={q.id === selectedId}
              onClick={() => onSelect(q.id)}
              onDelete={() => onDelete(q.id)}
              onMoveUp={() => onMove(q.id, -1)}
              onMoveDown={() => onMove(q.id, 1)}
            />
          ))}

          <button
            type="button"
            onClick={onAdd}
            className="w-full border-2 border-dashed border-dc-surface-3 hover:border-dc-blurple/50 hover:bg-dc-surface/50 rounded py-3 text-sm text-dc-mute2 hover:text-dc-text transition"
          >
            + добавить вопрос
          </button>
        </div>
      </div>
    </section>
  );
}

function QuestionRow({
  question,
  index,
  total,
  active,
  onClick,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  question: Question;
  index: number;
  total: number;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={classNames(
        "group rounded px-3 py-2.5 cursor-pointer transition flex items-start gap-3 border",
        active
          ? "bg-dc-surface-3 border-dc-blurple/40"
          : "bg-dc-surface border-transparent hover:border-dc-surface-3",
      )}
    >
      <span className="text-dc-mute2 text-xs font-mono mt-1 w-5 text-right shrink-0">
        {index + 1}
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-dc-text truncate">
          {question.text || (
            <span className="text-dc-mute2 italic">Без текста</span>
          )}
        </div>
        <div className="mt-1">
          <KindTag kind={question.kind} />
        </div>
      </div>

      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition shrink-0">
        <IconBtn
          onClick={(e) => {
            e.stopPropagation();
            if (index > 0) onMoveUp();
          }}
          disabled={index === 0}
          title="Выше"
        >
          ↑
        </IconBtn>
        <IconBtn
          onClick={(e) => {
            e.stopPropagation();
            if (index < total - 1) onMoveDown();
          }}
          disabled={index === total - 1}
          title="Ниже"
        >
          ↓
        </IconBtn>
        <IconBtn
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          danger
          title="Удалить"
        >
          ✕
        </IconBtn>
      </div>
    </div>
  );
}

function KindTag({ kind }: { kind: Question["kind"] }) {
  const palette: Record<Question["kind"], string> = {
    free: "bg-dc-surface-3 text-dc-muted border-dc-surface-3",
    single: "bg-dc-blurple/15 text-dc-blurple border-dc-blurple/40",
    multi: "bg-dc-green/15 text-dc-green border-dc-green/40",
  };
  return (
    <span
      className={classNames(
        "inline-block text-[10px] uppercase tracking-wider font-medium border rounded px-1.5 py-0.5",
        palette[kind],
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={classNames(
        "w-6 h-6 text-xs rounded transition",
        disabled
          ? "text-dc-surface-3 cursor-not-allowed"
          : danger
            ? "text-dc-mute2 hover:text-dc-red"
            : "text-dc-mute2 hover:text-dc-text",
      )}
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-dc-mute2 font-bold mb-1">
      {children}
    </div>
  );
}
