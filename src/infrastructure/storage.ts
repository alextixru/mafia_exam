import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  HeaderData,
  HeaderStore,
  MainMessageMap,
  MainMessageStore,
  PollRepository,
  SessionRepository,
} from "../application.ts";
import {
  parsePoll,
  sessionKey,
  type Poll,
  type PollId,
  type Session,
  type UserId,
} from "../domain.ts";

// ----------------------------------------------------------------------------
//  atomic write
// ----------------------------------------------------------------------------

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, filePath);
}

const isENOENT = (e: unknown): boolean =>
  (e as NodeJS.ErrnoException).code === "ENOENT";

// ----------------------------------------------------------------------------
//  PollRepository
// ----------------------------------------------------------------------------

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export class JsonPollRepository implements PollRepository {
  private readonly byId = new Map<PollId, Poll>();
  private readonly insertionOrder: PollId[] = [];

  private constructor(private readonly dir: string) {}

  static async load(dir: string): Promise<JsonPollRepository> {
    const repo = new JsonPollRepository(dir);
    await mkdir(dir, { recursive: true });
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(dir, entry.name);
      const raw = JSON.parse(await readFile(path, "utf8"));
      const result = parsePoll(raw);
      if (!result.ok) {
        console.warn(`skipping ${path}: ${result.error}`);
        continue;
      }
      if (repo.byId.has(result.value.id)) {
        console.warn(
          `skipping ${path}: duplicate poll id "${result.value.id}" (already loaded earlier)`,
        );
        continue;
      }
      repo.byId.set(result.value.id, result.value);
      repo.insertionOrder.push(result.value.id);
    }
    return repo;
  }

  async list(): Promise<readonly Poll[]> {
    return this.insertionOrder
      .map((id) => this.byId.get(id))
      .filter((p): p is Poll => p !== undefined);
  }

  async getById(id: PollId): Promise<Poll | null> {
    return this.byId.get(id) ?? null;
  }

  async save(poll: Poll): Promise<void> {
    if (!SAFE_ID.test(poll.id))
      throw new Error(`unsafe poll id: ${poll.id}`);
    await atomicWriteJson(this.fileFor(poll.id), poll);
    if (!this.byId.has(poll.id)) this.insertionOrder.push(poll.id);
    this.byId.set(poll.id, poll);
  }

  async delete(id: PollId): Promise<boolean> {
    if (!this.byId.has(id)) return false;
    if (!SAFE_ID.test(id)) throw new Error(`unsafe poll id: ${id}`);
    try {
      await unlink(this.fileFor(id));
    } catch (e) {
      if (!isENOENT(e)) throw e;
    }
    this.byId.delete(id);
    const idx = this.insertionOrder.indexOf(id);
    if (idx >= 0) this.insertionOrder.splice(idx, 1);
    return true;
  }

  private fileFor(id: PollId): string {
    return join(this.dir, `${id}.json`);
  }
}

// ----------------------------------------------------------------------------
//  SessionRepository
// ----------------------------------------------------------------------------

interface SessionFile {
  readonly version: 1;
  readonly sessions: readonly Session[];
}

export class JsonSessionRepository implements SessionRepository {
  private readonly map = new Map<string, Session>();

  private constructor(private readonly filePath: string) {}

  static async load(dataDir: string): Promise<JsonSessionRepository> {
    const filePath = join(dataDir, "sessions.json");
    const repo = new JsonSessionRepository(filePath);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as SessionFile;
      if (parsed.version === 1 && Array.isArray(parsed.sessions)) {
        for (const s of parsed.sessions) {
          if (s.status === "active")
            repo.map.set(sessionKey(s.userId, s.pollId), s);
        }
      }
    } catch (e) {
      if (!isENOENT(e)) throw e;
    }
    return repo;
  }

  async findActive(userId: UserId, pollId: PollId): Promise<Session | null> {
    const s = this.map.get(sessionKey(userId, pollId));
    return s && s.status === "active" ? s : null;
  }

  async save(session: Session): Promise<void> {
    this.map.set(sessionKey(session.userId, session.pollId), session);
    await this.flush();
  }

  async delete(userId: UserId, pollId: PollId): Promise<void> {
    if (this.map.delete(sessionKey(userId, pollId))) await this.flush();
  }

  private async flush(): Promise<void> {
    const file: SessionFile = {
      version: 1,
      sessions: Array.from(this.map.values()),
    };
    await atomicWriteJson(this.filePath, file);
  }
}

// ----------------------------------------------------------------------------
//  MainMessageStore
// ----------------------------------------------------------------------------

interface StateFile {
  readonly version: 2;
  /** channelId -> messageId главного embed-сообщения. */
  readonly mainMessages: Record<string, string>;
}

export class JsonStateStore implements MainMessageStore {
  private state: StateFile = { version: 2, mainMessages: {} };

  private constructor(private readonly filePath: string) {}

  static async load(dataDir: string): Promise<JsonStateStore> {
    const filePath = join(dataDir, "state.json");
    const store = new JsonStateStore(filePath);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as StateFile;
      if (parsed.version === 2 && parsed.mainMessages) {
        store.state = parsed;
      }
    } catch (e) {
      if (!isENOENT(e)) throw e;
    }
    return store;
  }

  async get(): Promise<MainMessageMap> {
    return this.state.mainMessages;
  }

  async set(channelId: string, messageId: string): Promise<void> {
    this.state = {
      version: 2,
      mainMessages: { ...this.state.mainMessages, [channelId]: messageId },
    };
    await atomicWriteJson(this.filePath, this.state);
  }

  async remove(channelId: string): Promise<void> {
    if (!(channelId in this.state.mainMessages)) return;
    const next = { ...this.state.mainMessages };
    delete next[channelId];
    this.state = { version: 2, mainMessages: next };
    await atomicWriteJson(this.filePath, this.state);
  }
}

// ----------------------------------------------------------------------------
//  HeaderStore
// ----------------------------------------------------------------------------

export class JsonHeaderStore implements HeaderStore {
  private header: HeaderData | null = null;

  private constructor(private readonly filePath: string) {}

  static async load(dataDir: string): Promise<JsonHeaderStore> {
    const filePath = join(dataDir, "header.json");
    const store = new JsonHeaderStore(filePath);
    try {
      store.header = JSON.parse(await readFile(filePath, "utf8")) as HeaderData;
    } catch (e) {
      if (!isENOENT(e)) throw e;
    }
    return store;
  }

  async get(): Promise<HeaderData | null> {
    return this.header;
  }

  async set(header: HeaderData): Promise<void> {
    this.header = header;
    await atomicWriteJson(this.filePath, header);
  }
}
