import { resolve } from "node:path";

export interface AppConfig {
  readonly discordToken: string;
  readonly applicationId: string;
  readonly clientSecret: string;
  readonly sessionSecret: string;
  readonly guildId: string;
  readonly pollsDir: string;
  readonly dataDir: string;
  readonly httpPort: number;
  /** Базовый URL фронта (куда редиректим после OAuth). */
  readonly appUrl: string;
  /** Где admin/dist лежит при проде. Если папки нет — раздача статики выключена. */
  readonly staticDir: string | null;
  /** "production" / "development" — влияет на cookie Secure-флаг. */
  readonly isProduction: boolean;
  /** Опциональный PIN для альтернативного входа в админку. */
  readonly adminPin: string | null;
}

const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`env var "${name}" is required`);
  return v;
};

export const loadConfig = (): AppConfig => {
  const isProduction = process.env.NODE_ENV === "production";
  const rawStatic = process.env.STATIC_DIR?.trim();
  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    applicationId: requireEnv("APPLICATION_ID"),
    clientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
    sessionSecret: requireEnv("SESSION_SECRET"),
    guildId: requireEnv("GUILD_ID"),
    pollsDir: resolve(process.env.POLLS_DIR ?? "polls"),
    dataDir: resolve(process.env.DATA_DIR ?? "data"),
    httpPort: Number(process.env.HTTP_PORT ?? 3000),
    appUrl: process.env.APP_URL ?? "http://localhost:5173",
    // ?? пропускает только null/undefined — пустую строку считаем тоже отсутствием.
    // resolve превращает относительный путь в абсолютный (от process.cwd),
    // чтобы Bun.file и path.startsWith работали стабильно.
    staticDir: rawStatic && rawStatic.length > 0 ? resolve(rawStatic) : null,
    isProduction,
    adminPin: process.env.ADMIN_PIN?.trim() || null,
  };
};
