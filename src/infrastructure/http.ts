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

  if (config.staticDir) {
    console.log(`Раздача SPA из: ${config.staticDir}`);
  } else {
    console.warn(
      "STATIC_DIR не задан — фронт не раздаётся. Запросы / вернут 404.",
    );
  }

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
      if (pathname === "/api/auth/options") return auth.options();
      if (pathname === "/api/auth/pin" && req.method === "POST")
        return auth.pinLogin(req);
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
        console.warn(`static 404: ${req.method} ${pathname}`);
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
 * SPA-static. Стратегия:
 *   - "/" или "" → отдаём index.html;
 *   - запрос с конкретным файлом (есть точка) → пробуем отдать файл, иначе 404;
 *   - всё остальное (роуты SPA) → отдаём index.html (history fallback).
 * Path traversal: запрещаем `..` после нормализации.
 */
async function serveStatic(
  staticDir: string,
  pathname: string,
): Promise<Response | null> {
  const safe = normalize(pathname).replace(/^[./\\]+/, "");
  if (safe.split(sep).includes("..")) return null;

  const indexPath = join(staticDir, "index.html");

  if (pathname === "/" || safe === "") {
    return tryFile(indexPath);
  }

  const candidate = join(staticDir, safe);
  // не выпускать из staticDir
  if (
    !candidate.startsWith(staticDir + sep) &&
    candidate !== staticDir
  ) {
    return null;
  }

  const direct = await tryFile(candidate);
  if (direct) return direct;

  // SPA-fallback: путь без расширения = роут React-Router'а
  if (!pathname.split("/").pop()?.includes(".")) {
    return tryFile(indexPath);
  }
  return null;
}

async function tryFile(path: string): Promise<Response | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return new Response(file);
}
