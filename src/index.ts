import { createUseCases } from "./application.ts";
import { loadConfig } from "./infrastructure/config.ts";
import {
  DiscordReportSink,
  createDiscordClient,
  ensureMainMessage,
  registerInteractionRouter,
  waitReady,
} from "./infrastructure/discord.ts";
import { startHttpServer } from "./infrastructure/http.ts";
import {
  JsonHeaderStore,
  JsonPollRepository,
  JsonSessionRepository,
  JsonStateStore,
} from "./infrastructure/storage.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  const polls = await JsonPollRepository.load(config.pollsDir);
  const sessions = await JsonSessionRepository.load(config.dataDir);
  const stateStore = await JsonStateStore.load(config.dataDir);
  const headerStore = await JsonHeaderStore.load(config.dataDir);

  const client = createDiscordClient();
  await client.login(config.discordToken);
  const ready = await waitReady(client);
  console.log(`Бот запущен: ${ready.user.tag}`);

  const reports = new DiscordReportSink(ready, config.reportChannelId);
  const useCases = createUseCases({ polls, sessions, reports });

  const mainMessageDeps = {
    client: ready,
    store: stateStore,
    headers: headerStore,
    channelId: config.mainChannelId,
  };

  registerInteractionRouter(ready, {
    useCases,
    mainMessageDeps,
    examDeps: { client: ready, mainMessageDeps, useCases },
  });

  await ensureMainMessage(mainMessageDeps, await polls.list());
  console.log("Главное сообщение готово.");

  const server = startHttpServer({
    config,
    useCases,
    refreshMainMessage: async () => {
      await ensureMainMessage(mainMessageDeps, await polls.list());
    },
  });
  console.log(`HTTP API на http://localhost:${server.port}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
