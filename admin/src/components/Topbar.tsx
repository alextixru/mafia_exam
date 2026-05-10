import type { CurrentUser } from "../api.ts";

interface Props {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  user: CurrentUser;
  onSave: () => void;
  onReset: () => void;
  onLogout: () => void;
}

export function Topbar({
  dirty,
  saving,
  saved,
  error,
  user,
  onSave,
  onReset,
  onLogout,
}: Props) {
  return (
    <header className="h-12 flex items-center justify-between px-4 bg-dc-surface border-b border-dc-border shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-bold text-dc-text">
          mafia-opros · admin
        </span>
        {error && (
          <span className="text-xs text-dc-red truncate" title={error}>
            ⚠ {error}
          </span>
        )}
        <Status dirty={dirty} saved={saved} />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onReset}
          disabled={!dirty}
          className="text-xs font-medium text-dc-muted hover:text-dc-text disabled:text-dc-surface-3 disabled:cursor-not-allowed px-3 py-1.5 transition"
        >
          Отменить
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="text-xs font-bold bg-dc-blurple hover:bg-dc-blurple-h text-white disabled:bg-dc-surface-3 disabled:text-dc-mute2 disabled:cursor-not-allowed px-4 py-1.5 rounded transition"
        >
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        <UserBadge user={user} onLogout={onLogout} />
      </div>
    </header>
  );
}

function UserBadge({
  user,
  onLogout,
}: {
  user: CurrentUser;
  onLogout: () => void;
}) {
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32`
    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;

  return (
    <div className="flex items-center gap-2 pl-3 border-l border-dc-border">
      <img
        src={avatarUrl}
        alt=""
        width={24}
        height={24}
        className="rounded-full"
      />
      <span className="text-xs text-dc-text">{user.username}</span>
      <button
        type="button"
        onClick={onLogout}
        className="text-xs text-dc-mute2 hover:text-dc-red transition"
        title="Выйти"
      >
        выйти
      </button>
    </div>
  );
}

function Status({ dirty, saved }: { dirty: boolean; saved: boolean }) {
  if (saved) return <span className="text-xs text-dc-green">✓ сохранено</span>;
  if (dirty)
    return (
      <span className="text-xs text-dc-yellow">● несохранённые изменения</span>
    );
  return null;
}
