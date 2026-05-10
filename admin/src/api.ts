import type { Poll, PollId } from "@shared/poll-schema.ts";

export async function fetchPolls(): Promise<Poll[]> {
  const res = await fetch("/api/polls");
  if (!res.ok) throw new Error(`GET /api/polls: ${res.status}`);
  return (await res.json()) as Poll[];
}

export async function savePoll(poll: Poll): Promise<Poll> {
  const res = await fetch("/api/polls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(poll),
  });
  if (!res.ok) {
    const body = await safeError(res);
    throw new Error(body ?? `POST /api/polls: ${res.status}`);
  }
  return (await res.json()) as Poll;
}

export async function deletePoll(id: PollId): Promise<void> {
  const res = await fetch(`/api/polls/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const body = await safeError(res);
    throw new Error(body ?? `DELETE /api/polls/${id}: ${res.status}`);
  }
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
//  Auth
// ============================================================================

export interface CurrentUser {
  id: string;
  username: string;
  avatar: string | null;
}

export async function fetchMe(): Promise<CurrentUser | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) throw new Error(`GET /api/auth/me: ${res.status}`);
  const data = (await res.json()) as { user: CurrentUser | null };
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export const loginUrl = "/api/auth/login";

export interface AuthOptions {
  pin: boolean;
  discord: boolean;
}

export async function fetchAuthOptions(): Promise<AuthOptions> {
  const res = await fetch("/api/auth/options");
  if (!res.ok) throw new Error(`GET /api/auth/options: ${res.status}`);
  return (await res.json()) as AuthOptions;
}

export async function pinLogin(pin: string): Promise<void> {
  const res = await fetch("/api/auth/pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (res.ok) return;
  if (res.status === 401) throw new Error("Неверный PIN");
  if (res.status === 429) throw new Error("Слишком много попыток. Подождите.");
  throw new Error(`POST /api/auth/pin: ${res.status}`);
}
