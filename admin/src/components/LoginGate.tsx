import { useEffect, useState } from "react";
import {
  fetchAuthOptions,
  fetchMe,
  loginUrl,
  pinLogin,
  type CurrentUser,
} from "../api.ts";

type AuthState =
  | { kind: "loading" }
  | { kind: "anon"; denied: string | null; allowPin: boolean; allowDiscord: boolean }
  | { kind: "authed"; user: CurrentUser };

interface Props {
  children: (user: CurrentUser) => React.ReactNode;
}

export function LoginGate({ children }: Props) {
  const [state, setState] = useState<AuthState>({ kind: "loading" });

  useEffect(() => {
    const denied = new URLSearchParams(window.location.search).get("denied");
    Promise.all([fetchMe(), fetchAuthOptions().catch(() => null)])
      .then(([user, options]) => {
        if (user) {
          setState({ kind: "authed", user });
          if (denied) cleanQueryString();
          return;
        }
        setState({
          kind: "anon",
          denied,
          allowPin: options?.pin ?? false,
          allowDiscord: options?.discord ?? true,
        });
      })
      .catch(() =>
        setState({
          kind: "anon",
          denied,
          allowPin: false,
          allowDiscord: true,
        }),
      );
  }, []);

  if (state.kind === "loading") {
    return (
      <Center>
        <span className="text-dc-muted text-sm">Проверяю сессию…</span>
      </Center>
    );
  }

  if (state.kind === "anon") {
    return (
      <Center>
        <div className="max-w-sm w-full space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-bold text-dc-text">
              mafia-opros · admin
            </h1>
            <p className="text-sm text-dc-muted mt-1">
              Войдите, чтобы редактировать опросы.
            </p>
          </div>

          {state.denied && (
            <div className="text-sm text-dc-red bg-dc-red/10 border border-dc-red/30 rounded px-3 py-2 text-center">
              Доступ запрещён: {state.denied}
            </div>
          )}

          {state.allowDiscord && (
            <a
              href={loginUrl}
              className="inline-flex items-center justify-center gap-2 bg-dc-blurple hover:bg-dc-blurple-h text-white font-bold rounded px-4 py-2 text-sm transition w-full"
            >
              Войти через Discord
            </a>
          )}

          {state.allowPin && state.allowDiscord && <Divider>или</Divider>}

          {state.allowPin && <PinForm />}
        </div>
      </Center>
    );
  }

  return <>{children(state.user)}</>;
}

function PinForm() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || pin.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await pinLogin(pin);
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        type="password"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="PIN"
        className="w-full bg-dc-bg border border-dc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-dc-blurple transition"
      />
      {error && <div className="text-sm text-dc-red">{error}</div>}
      <button
        type="submit"
        disabled={busy || pin.length === 0}
        className="w-full text-sm font-bold bg-dc-surface-3 hover:bg-dc-surface-2 text-dc-text disabled:opacity-50 disabled:cursor-not-allowed rounded px-3 py-2 transition"
      >
        {busy ? "Проверяю…" : "Войти по PIN"}
      </button>
    </form>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-dc-border" />
      <span className="text-xs text-dc-mute2 uppercase tracking-wider">
        {children}
      </span>
      <div className="flex-1 h-px bg-dc-border" />
    </div>
  );
}

function cleanQueryString() {
  const url = new URL(window.location.href);
  url.searchParams.delete("denied");
  window.history.replaceState({}, "", url.toString());
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-dc-bg flex items-center justify-center p-6">
      {children}
    </div>
  );
}
