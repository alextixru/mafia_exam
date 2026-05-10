import { REST, Routes } from "discord.js";
import { loadConfig } from "../infrastructure/config.ts";
import { slashCommands } from "../infrastructure/discord.ts";

const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.discordToken);
const body = slashCommands.map((c) => c.toJSON());

console.log(
  `Registering ${body.length} command(s) for guild ${config.guildId}…`,
);

await rest.put(
  Routes.applicationGuildCommands(config.applicationId, config.guildId),
  { body },
);

console.log("Done.");
