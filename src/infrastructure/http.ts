import { join, normalize, sep } from "node:path";
import type { UseCases } from "../application.ts";
import { AuthService } from "./auth.ts";
import type { AppConfig } from "./config.ts";

export interface HttpDeps {
  readonly config: AppConfig;
  readonly useCases: UseCases;
  readonly refreshMainMessage: () => Promise<void>;
}

const json = (data: unknown, init?: ResponseInit): Response =>
  Response.json(data, init);

const error = (status: number, message: string): Response =>
  json({ error: message }, { status });

export function startHttpServer(deps: HttpDeps) {
  const { config, useCases, refreshMainMessage } = deps;
  const auth = new AuthService(config);

  return Bun.serve({
    port: config.httpPort,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      // ─── auth ───────────────────────────────────────────────────
      if (pathname === "/api/auth/login")
        return auth.startLogin();
      if (pathname === "/api/auth/callback")
        return auth.handleCallback(req);
      if (pathname === "/api/auth/me") return auth.me(req);
      if (pathname === "/api/auth/logout" && req.method === "POST")
        return auth.logout();

      // ─── public API ─────────────────────────────────────────────
      if (req.method === "GET" && pathname === "/api/health") {
        return json({ ok: true });
      }

      // ─── protected API ─────────────────────────────────────────
      if (pathname.startsWith("/api/")) {
        const session = auth.readSession(req);
        if (!session) return error(401, "unauthorized");

        if (req.method === "GET" && pathname === "/api/polls") {
          return json(await useCases.listPolls());
        }

        if (req.method === "POST" && pathname === "/api/polls") {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return error(400, "invalid json");
          }
          const result = await useCases.savePoll({ raw: body });
          if (!result.ok) return error(400, result.error.message);
          await safeRefresh(refreshMainMessage, "save");
          return json(result.value);
        }

        const deleteMatch = pathname.match(/^\/api\/polls\/([^/]+)$/);
        if (req.method === "DELETE" && deleteMatch) {
          const id = decodeURIComponent(deleteMatch[1]!);
          const { deleted } = await useCases.deletePoll({ id });
          if (!deleted) return error(404, "poll not found");
          await safeRefresh(refreshMainMessage, "delete");
          return new Response(null, { status: 204 });
        }

        return error(404, "not found");
      }

      // ─── static (admin/dist) ────────────────────────────────────
      if (config.staticDir) {
        const staticRes = await serveStatic(config.staticDir, pathname);
        if (staticRes) return staticRes;
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}

async function safeRefresh(
  refresh: () => Promise<void>,
  what: string,
): Promise<void> {
  try {
    await refresh();
  } catch (e) {
    console.error(`refreshMainMessage failed after ${what}:`, e);
  }
}

/**
 * SPA-static: пытается отдать файл; если файла нет — отдаёт index.html.
 * Защищает от path traversal — нормализованный путь должен оставаться
 * внутри staticDir.
 */
async function serveStatic(
  staticDir: string,
  pathname: string,
): Promise<Response | null> {
  const safe = normalize(pathname).replace(/^([./\\])+/, "");
  const candidate = join(staticDir, safe);

  if (!candidate.startsWith(staticDir + sep) && candidate !== staticDir) {
    return null;
  }

  const file = Bun.file(candidate);
  if (await file.exists()) {
    return new Response(file);
  }

  // SPA-fallback: любой неизвестный путь без расширения → index.html
  if (!pathname.includes(".") || pathname === "/") {
    const index = Bun.file(join(staticDir, "index.html"));
    if (await index.exists()) return new Response(index);
  }

  return null;
}
