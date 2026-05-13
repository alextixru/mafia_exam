import type {
  MultiQuestion,
  Option,
  Question,
  QuestionKind,
  SingleQuestion,
} from "@shared/poll-schema.ts";
import { KIND_LABEL, newOption, newQuestion } from "../poll-ui.ts";
import { classNames } from "../utils.ts";

interface Props {
  question: Question | null;
  index: number; // 0-based, для заголовка
  onChange: (q: Question) => void;
}

export function QuestionEditor({ question, index, onChange }: Props) {
  if (!question) {
    return (
      <aside className="bg-dc-surface flex items-center justify-center px-6 text-center min-w-0">
        <div className="text-sm text-dc-mute2 italic">
          Выберите вопрос
          <br />
          для редактирования
        </div>
      </aside>
    );
  }

  return (
    <aside className="bg-dc-surface flex flex-col min-w-0">
      <div className="h-12 px-5 border-b border-dc-border flex items-center shrink-0">
        <div className="text-xs font-bold uppercase tracking-wider text-dc-muted">
          Вопрос #{index + 1}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <Field label="Текст вопроса">
          <textarea
            value={question.text}
            onChange={(e) => onChange({ ...question, text: e.target.value })}
            rows={3}
            className="w-full bg-dc-bg border border-dc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-dc-blurple transition resize-y"
          />
        </Field>

        <Field label="Тип ответа">
          <div className="grid grid-cols-3 gap-1 bg-dc-bg border border-dc-border rounded p-1">
            {(Object.keys(KIND_LABEL) as QuestionKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (k === question.kind) return;
                  const fresh = newQuestion(k, question.id);
                  onChange({ ...fresh, text: question.text });
                }}
                className={classNames(
                  "py-1.5 text-xs rounded transition font-medium",
                  k === question.kind
                    ? "bg-dc-blurple text-white"
                    : "text-dc-muted hover:text-dc-text hover:bg-dc-surface-3",
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>

        {(question.kind === "single" || question.kind === "multi") && (
          <OptionsEditor question={question} onChange={onChange} />
        )}

        {question.kind === "multi" && (
          <MultiBounds question={question} onChange={onChange} />
        )}
      </div>
    </aside>
  );
}

function OptionsEditor({
  question,
  onChange,
}: {
  question: SingleQuestion | MultiQuestion;
  onChange: (q: Question) => void;
}) {
  const updateOption = (i: number, patch: Partial<Option>) => {
    const options = question.options.map((o, idx) =>
      idx === i ? { ...o, ...patch } : o,
    );
    onChange({ ...question, options });
  };
  const removeOption = (i: number) => {
    const options = question.options.filter((_, idx) => idx !== i);
    if (question.kind === "multi") {
      const max = Math.min(question.max, Math.max(options.length, 1));
      const min = Math.min(question.min, max);
      onChange({ ...question, options, min, max });
    } else {
      onChange({ ...question, options });
    }
  };
  const addOption = () => {
    const idx = question.options.length + 1;
    onChange({
      ...question,
      options: [...question.options, newOption(`Вариант ${idx}`)],
    });
  };

  return (
    <Field label="Варианты ответа">
      <div className="space-y-2">
        {question.options.map((o, i) => (
          <div key={o.value} className="flex gap-1.5 items-center">
            <input
              value={o.label}
              onChange={(e) => updateOption(i, { label: e.target.value })}
              placeholder="Подпись"
              className="flex-1 bg-dc-bg border border-dc-border rounded px-2 py-1 text-sm focus:outline-none focus:border-dc-blurple transition"
            />
            <button
              type="button"
              onClick={() => removeOption(i)}
              disabled={question.options.length <= 1}
              className="text-dc-mute2 hover:text-dc-red disabled:text-dc-surface-3 disabled:cursor-not-allowed text-xs w-6 h-6 transition"
              title="Удалить"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          className="text-xs text-dc-blurple hover:text-dc-text transition"
        >
          + добавить вариант
        </button>
      </div>
    </Field>
  );
}

function MultiBounds({
  question,
  onChange,
}: {
  question: MultiQuestion;
  onChange: (q: Question) => void;
}) {
  const cap = question.options.length;
  return (
    <Field label="Сколько можно выбрать">
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label="мин"
          value={question.min}
          min={1}
          max={question.max}
          onChange={(v) => onChange({ ...question, min: v })}
        />
        <NumberInput
          label="макс"
          value={question.max}
          min={question.min}
          max={cap}
          onChange={(v) => onChange({ ...question, max: v })}
        />
      </div>
    </Field>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-dc-mute2">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="w-full bg-dc-bg border border-dc-border rounded px-2 py-1 text-sm focus:outline-none focus:border-dc-blurple transition"
      />
    </label>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-dc-mute2 font-bold mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
