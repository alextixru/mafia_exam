import { Discord, generateState } from "arctic";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config.ts";

// ============================================================================
//  JWT (HS256, без зависимостей)
// ============================================================================

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64url");

const b64urlDecode = (s: string): Buffer => Buffer.from(s, "base64url");

interface SessionPayload {
  /** Discord user id. */
  readonly sub: string;
  readonly username: string;
  readonly avatar: string | null;
  /** Unix seconds. */
  readonly exp: number;
}

const SESSION_TTL_S = 7 * 24 * 60 * 60; // 7 дней

function signSession(
  secret: string,
  payload: Omit<SessionPayload, "exp">,
): string {
  const full: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(full));
  const sig = b64url(
    createHmac("sha256", secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${sig}`;
}

function verifySession(secret: string, token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];

  const expected = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest();
  const got = b64urlDecode(sig);
  if (got.length !== expected.length) return null;
  if (!timingSafeEqual(got, expected)) return null;

  try {
    const payload = JSON.parse(
      b64urlDecode(body).toString("utf8"),
    ) as SessionPayload;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ============================================================================
//  Cookies
// ============================================================================

export const SESSION_COOKIE = "mo_sess";
const STATE_COOKIE = "mo_oauth_state";

const parseCookies = (header: string | null): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) continue;
    out[name] = decodeURIComponent(rest.join("="));
  }
  return out;
};

const buildCookie = (
  name: string,
  value: string,
  opts: {
    maxAge?: number;
    secure?: boolean;
  } = {},
): string => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (opts.secure) parts.push("Secure");
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
};

const clearCookie = (name: string, secure: boolean): string =>
  buildCookie(name, "", { maxAge: 0, secure });

// ============================================================================
//  Discord identity
// ============================================================================

interface OAuthMember {
  readonly user?: { id: string; username: string; avatar: string | null };
  readonly nick?: string | null;
  readonly roles: readonly string[];
}

interface DiscordRole {
  readonly id: string;
  readonly permissions: string;
}

interface DiscordGuild {
  readonly owner_id?: string;
  readonly roles: DiscordRole[];
}

const ADMIN_PERM_BIT = 0x8n; // PermissionFlagsBits.Administrator
const SCOPES = ["identify", "guilds.members.read"];

// ============================================================================
//  AuthService
// ============================================================================

export class AuthService {
  private readonly discord: Discord;

  constructor(private readonly cfg: AppConfig) {
    this.discord = new Discord(
      cfg.applicationId,
      cfg.clientSecret,
      this.redirectUri(),
    );
  }

  /** GET /api/auth/login */
  startLogin(): Response {
    const state = generateState();
    const url = this.discord.createAuthorizationURL(state, null, SCOPES);
    url.searchParams.set("prompt", "none");

    return new Response(null, {
      status: 302,
      headers: {
        Location: url.toString(),
        "Set-Cookie": buildCookie(STATE_COOKIE, state, {
          maxAge: 600,
          secure: this.cfg.isProduction,
        }),
      },
    });
  }

  /** GET /api/auth/callback */
  async handleCallback(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return text(400, "missing code/state");

    const cookies = parseCookies(req.headers.get("cookie"));
    if (cookies[STATE_COOKIE] !== state) return text(400, "invalid state");

    let accessToken: string;
    try {
      const tokens = await this.discord.validateAuthorizationCode(code, null);
      accessToken = tokens.accessToken();
    } catch (e) {
      console.error("oauth exchange failed:", e);
      return text(502, "discord oauth exchange failed");
    }

    const member = await fetchGuildMember(this.cfg.guildId, accessToken);
    if (!member?.user) return this.deny("not a member of the guild");

    const allowed = await isAdminMember(member, this.cfg);
    if (!allowed) return this.deny("not an admin");

    const session = signSession(this.cfg.sessionSecret, {
      sub: member.user.id,
      username: member.nick ?? member.user.username,
      avatar: member.user.avatar,
    });

    const headers = new Headers({ Location: this.cfg.appUrl });
    headers.append(
      "Set-Cookie",
      buildCookie(SESSION_COOKIE, session, {
        maxAge: SESSION_TTL_S,
        secure: this.cfg.isProduction,
      }),
    );
    headers.append(
      "Set-Cookie",
      clearCookie(STATE_COOKIE, this.cfg.isProduction),
    );
    return new Response(null, { status: 302, headers });
  }

  /** GET /api/auth/me */
  me(req: Request): Response {
    const session = this.readSession(req);
    if (!session) return Response.json({ user: null });
    return Response.json({
      user: {
        id: session.sub,
        username: session.username,
        avatar: session.avatar,
      },
    });
  }

  /** POST /api/auth/logout */
  logout(): Response {
    return new Response(null, {
      status: 204,
      headers: {
        "Set-Cookie": clearCookie(SESSION_COOKIE, this.cfg.isProduction),
      },
    });
  }

  /** Используется как middleware из http.ts. */
  readSession(req: Request): SessionPayload | null {
    const cookies = parseCookies(req.headers.get("cookie"));
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;
    return verifySession(this.cfg.sessionSecret, token);
  }

  private redirectUri(): string {
    return `${this.cfg.appUrl.replace(/\/$/, "")}/api/auth/callback`;
  }

  private deny(reason: string): Response {
    const headers = new Headers({
      Location: `${this.cfg.appUrl}/?denied=${encodeURIComponent(reason)}`,
    });
    headers.append(
      "Set-Cookie",
      clearCookie(STATE_COOKIE, this.cfg.isProduction),
    );
    return new Response(null, { status: 302, headers });
  }
}

// ============================================================================
//  Helpers — admin check
// ============================================================================

async function fetchGuildMember(
  guildId: string,
  accessToken: string,
): Promise<OAuthMember | null> {
  const res = await fetch(
    `https://discord.com/api/users/@me/guilds/${guildId}/member`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  return (await res.json()) as OAuthMember;
}

async function fetchGuildAsBot(
  guildId: string,
  botToken: string,
): Promise<DiscordGuild | null> {
  const res = await fetch(`https://discord.com/api/guilds/${guildId}`, {
    headers: { authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    console.error("fetch guild as bot failed:", res.status, await res.text());
    return null;
  }
  return (await res.json()) as DiscordGuild;
}

/**
 * У участника гильдии есть Administrator? Берём роли участника, тащим
 * permissions ролей через бот-токен, считаем bitwise OR. Owner — тоже да.
 */
async function isAdminMember(
  member: OAuthMember,
  cfg: AppConfig,
): Promise<boolean> {
  if (!member.user) return false;
  const guild = await fetchGuildAsBot(cfg.guildId, cfg.discordToken);
  if (!guild) return false;
  if (guild.owner_id === member.user.id) return true;

  const roleSet = new Set(member.roles);
  let perms = 0n;
  for (const role of guild.roles) {
    // @everyone роль имеет id равный guildId
    const isEveryone = role.id === cfg.guildId;
    if (!isEveryone && !roleSet.has(role.id)) continue;
    try {
      perms |= BigInt(role.permissions);
    } catch {
      // ignore bad permissions string
    }
  }
  return (perms & ADMIN_PERM_BIT) === ADMIN_PERM_BIT;
}

const text = (status: number, msg: string): Response =>
  new Response(msg, { status, headers: { "content-type": "text/plain" } });
