import { ComponentType, type APIMessageTopLevelComponent } from "discord.js";

const ALLOWED_HOSTS = new Set([
  "discohook.app",
  "share.discohook.app",
  "discohook.org",
]);

const TOTAL_TEXT_LIMIT = 4000;
const TOTAL_COMPONENTS_LIMIT = 39; // +1 на наш select-меню = 40

export class DiscohookError extends Error {}

export interface ParsedHeader {
  readonly components: APIMessageTopLevelComponent[];
}

export async function parseDiscohookHeader(
  rawUrl: string,
): Promise<ParsedHeader> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DiscohookError("Invalid URL");
  }
  if (url.protocol !== "https:")
    throw new DiscohookError("Only https:// URLs are allowed");
  if (!ALLOWED_HOSTS.has(url.hostname))
    throw new DiscohookError(
      `Host not allowed: ${url.hostname}. Use discohook.app or share.discohook.app`,
    );

  const json = await loadPayload(url);
  return extractHeader(json);
}

async function loadPayload(url: URL): Promise<unknown> {
  const shareId = extractShareId(url);
  if (shareId) return resolveShareLink(shareId);

  const dataParam = url.searchParams.get("data");
  if (!dataParam || dataParam.length === 0)
    throw new DiscohookError(
      "В ссылке нет ни ?data=..., ни ?share=.... Скопируй URL из Discohook → Share Message.",
    );
  try {
    return JSON.parse(urlSafeBase64Decode(dataParam));
  } catch (err) {
    throw new DiscohookError(
      `Не удалось декодировать ?data=: ${(err as Error).message}`,
    );
  }
}

function extractShareId(url: URL): string | null {
  const id = url.searchParams.get("share");
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    throw new DiscohookError(`Invalid share id format: ${id}`);
  return id;
}

async function resolveShareLink(shareId: string): Promise<unknown> {
  const apiUrl = `https://discohook.app/api/v1/share/${encodeURIComponent(shareId)}`;
  const res = await fetch(apiUrl, { headers: { accept: "application/json" } });
  if (!res.ok)
    throw new DiscohookError(
      `Discohook share API: ${res.status} ${res.statusText} (ссылка истекла или удалена?)`,
    );
  const body = (await res.json()) as { data?: unknown };
  if (!body.data) throw new DiscohookError("Discohook share API: ответ без поля data");
  return body.data;
}

function urlSafeBase64Decode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function extractHeader(payload: unknown): ParsedHeader {
  if (!payload || typeof payload !== "object")
    throw new DiscohookError("Discohook payload is not an object");
  const obj = payload as Record<string, unknown>;

  const rawMessages: Record<string, unknown>[] = Array.isArray(obj.messages)
    ? (obj.messages as Record<string, unknown>[])
    : [obj];

  if (rawMessages.length === 0)
    throw new DiscohookError("Не нашли ни одного сообщения в payload.");
  if (rawMessages.length > 1)
    throw new DiscohookError(
      `Шапка должна быть одним сообщением, найдено ${rawMessages.length}. Удали лишние вкладки в Discohook.`,
    );

  const raw = rawMessages[0]!;
  const data = (raw.data ?? raw) as Record<string, unknown>;

  const rawComponents = Array.isArray(data.components)
    ? (data.components as APIMessageTopLevelComponent[])
    : [];
  if (rawComponents.length === 0)
    throw new DiscohookError(
      "В шапке нет components. Включи режим Components V2 и собери сообщение из контейнеров/текста.",
    );

  // Top-level ActionRow в шапке игнорируем — наш select-меню добавим ниже.
  const filtered = rawComponents.filter(
    (c) => c.type !== ComponentType.ActionRow,
  );
  if (filtered.length === 0)
    throw new DiscohookError(
      "После фильтрации не осталось компонентов (в шапке были только ActionRow).",
    );

  validateLimits(filtered);
  return { components: filtered };
}

function validateLimits(components: APIMessageTopLevelComponent[]): void {
  let textTotal = 0;
  let componentTotal = 0;

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    componentTotal++;
    const n = node as Record<string, unknown>;
    if (typeof n.content === "string" && n.type === ComponentType.TextDisplay)
      textTotal += n.content.length;
    if (Array.isArray(n.components)) for (const c of n.components) visit(c);
    if (Array.isArray(n.items)) for (const c of n.items) visit(c);
    if (n.accessory) visit(n.accessory);
  };

  for (const c of components) visit(c);

  if (componentTotal > TOTAL_COMPONENTS_LIMIT)
    throw new DiscohookError(
      `Слишком много компонентов: ${componentTotal} (лимит ${TOTAL_COMPONENTS_LIMIT}, +1 на select-меню = 40).`,
    );
  if (textTotal > TOTAL_TEXT_LIMIT)
    throw new DiscohookError(
      `Суммарный текст в TextDisplay: ${textTotal} символов (лимит ${TOTAL_TEXT_LIMIT}).`,
    );
}
