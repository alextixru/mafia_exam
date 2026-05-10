export interface AppConfig {
  readonly discordToken: string;
  readonly applicationId: string;
  readonly clientSecret: string;
  readonly sessionSecret: string;
  readonly guildId: string;
  readonly mainChannelId: string;
  readonly reportChannelId: string;
  readonly pollsDir: string;
  readonly dataDir: string;
  readonly httpPort: number;
  /** Базовый URL фронта (куда редиректим после OAuth). */
  readonly appUrl: string;
  /** Где admin/dist лежит при проде. Если папки нет — раздача статики выключена. */
  readonly staticDir: string | null;
  /** "production" / "development" — влияет на cookie Secure-флаг. */
  readonly isProduction: boolean;
}

const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`env var "${name}" is required`);
  return v;
};

export const loadConfig = (): AppConfig => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    applicationId: requireEnv("APPLICATION_ID"),
    clientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
    sessionSecret: requireEnv("SESSION_SECRET"),
    guildId: requireEnv("GUILD_ID"),
    mainChannelId: requireEnv("MAIN_CHANNEL_ID"),
    reportChannelId: requireEnv("REPORT_CHANNEL_ID"),
    pollsDir: process.env.POLLS_DIR ?? "polls",
    dataDir: process.env.DATA_DIR ?? "data",
    httpPort: Number(process.env.HTTP_PORT ?? 3000),
    appUrl: process.env.APP_URL ?? "http://localhost:5173",
    staticDir: process.env.STATIC_DIR ?? null,
    isProduction,
  };
};
