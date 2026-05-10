import { useEffect, useState } from "react";
import { fetchMe, loginUrl, type CurrentUser } from "../api.ts";

type AuthState =
  | { kind: "loading" }
  | { kind: "anon"; denied: string | null }
  | { kind: "authed"; user: CurrentUser };

interface Props {
  children: (user: CurrentUser) => React.ReactNode;
}

export function LoginGate({ children }: Props) {
  const [state, setState] = useState<AuthState>({ kind: "loading" });

  useEffect(() => {
    const denied = new URLSearchParams(window.location.search).get("denied");
    fetchMe()
      .then((user) => {
        if (user) {
          setState({ kind: "authed", user });
          if (denied) cleanQueryString();
        } else {
          setState({ kind: "anon", denied });
        }
      })
      .catch(() => setState({ kind: "anon", denied }));
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
        <div className="max-w-sm text-center space-y-4">
          <div>
            <h1 className="text-xl font-bold text-dc-text">
              mafia-opros · admin
            </h1>
            <p className="text-sm text-dc-muted mt-1">
              Войдите через Discord. Доступ только для администраторов сервера.
            </p>
          </div>
          {state.denied && (
            <div className="text-sm text-dc-red bg-dc-red/10 border border-dc-red/30 rounded px-3 py-2">
              Доступ запрещён: {state.denied}
            </div>
          )}
          <a
            href={loginUrl}
            className="inline-flex items-center justify-center gap-2 bg-dc-blurple hover:bg-dc-blurple-h text-white font-bold rounded px-4 py-2 text-sm transition w-full"
          >
            Войти через Discord
          </a>
        </div>
      </Center>
    );
  }

  return <>{children(state.user)}</>;
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
