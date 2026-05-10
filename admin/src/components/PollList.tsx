import type { Poll, PollId } from "@shared/poll-schema.ts";
import { classNames } from "../utils.ts";

interface Props {
  polls: Poll[];
  selectedId: PollId | null;
  onSelect: (id: PollId) => void;
  onCreate: () => void;
  onDelete: (id: PollId) => void;
}

export function PollList({
  polls,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  return (
    <aside className="flex flex-col bg-dc-surface min-w-0">
      <div className="h-12 flex items-center justify-between px-4 border-b border-dc-border shrink-0">
        <span className="text-xs font-bold uppercase tracking-wider text-dc-muted">
          Опросы
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="text-dc-muted hover:text-dc-text w-7 h-7 rounded transition flex items-center justify-center text-xl leading-none"
          title="Создать опрос"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {polls.length === 0 && (
          <div className="text-xs text-dc-mute2 italic p-3 text-center">
            Опросов пока нет
          </div>
        )}
        {polls.map((p) => {
          const active = p.id === selectedId;
          return (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={classNames(
                "group rounded px-2.5 py-2 cursor-pointer transition flex items-start gap-2",
                active
                  ? "bg-dc-surface-3 text-dc-text"
                  : "text-dc-muted hover:bg-dc-surface-2 hover:text-dc-text",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {p.title || (
                    <span className="text-dc-mute2 italic">Без названия</span>
                  )}
                </div>
                <div className="text-xs text-dc-mute2 mt-0.5">
                  {p.questions.length} вопр.
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Удалить опрос "${p.title || p.id}"?`))
                    onDelete(p.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-dc-mute2 hover:text-dc-red text-sm transition"
                title="Удалить"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
