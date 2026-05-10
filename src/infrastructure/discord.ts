import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  Client,
  ComponentType,
  DiscordAPIError,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIEmbed,
  type APIMessageTopLevelComponent,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type SendableChannels,
  type StringSelectMenuInteraction,
} from "discord.js";
import { DiscohookError, parseDiscohookHeader } from "../discohook.ts";
import type {
  HeaderStore,
  MainMessageStore,
  QuestionView,
  ReportSink,
  UseCases,
} from "../application.ts";
import type {
  Answer,
  FreeQuestion,
  MultiAnswer,
  Poll,
  PollId,
  Question,
  QuestionId,
  SingleAnswer,
  SurveyReport,
} from "../domain.ts";

// ============================================================================
//  Client
// ============================================================================

export const createDiscordClient = (): Client =>
  new Client({ intents: [GatewayIntentBits.Guilds] });

export const waitReady = (client: Client): Promise<Client<true>> =>
  new Promise((resolve) => {
    client.once(Events.ClientReady, resolve);
  });

const isSendable = (
  ch: { type: ChannelType } | null,
): ch is { type: ChannelType } & SendableChannels => {
  if (!ch) return false;
  return (
    ch.type === ChannelType.GuildText ||
    ch.type === ChannelType.GuildAnnouncement ||
    ch.type === ChannelType.PublicThread ||
    ch.type === ChannelType.PrivateThread ||
    ch.type === ChannelType.AnnouncementThread
  );
};

// ============================================================================
//  customId protocol: "<scope>:<action>[:arg]*"
// ============================================================================

const SEP = ":";

const Id = {
  mainMenuSelect: "mainmenu:select",
  singleSelect: (p: string, q: string) => `survey:single${SEP}${p}${SEP}${q}`,
  multiSelect: (p: string, q: string) => `survey:multi${SEP}${p}${SEP}${q}`,
  openModal: (p: string, q: string) => `survey:open-modal${SEP}${p}${SEP}${q}`,
  answerModal: (p: string, q: string) => `survey:answer-modal${SEP}${p}${SEP}${q}`,
  navBack: (p: string) => `survey:nav-back${SEP}${p}`,
  navNext: (p: string) => `survey:nav-next${SEP}${p}`,
  navFinish: (p: string) => `survey:nav-finish${SEP}${p}`,
  navCancel: (p: string) => `survey:nav-cancel${SEP}${p}`,
} as const;

const MODAL_INPUT = "answer";

interface Parsed {
  readonly scope: string;
  readonly action: string;
  readonly args: readonly string[];
}

const parseId = (raw: string): Parsed | null => {
  const [scope, action, ...args] = raw.split(SEP);
  if (!scope || !action) return null;
  return { scope, action, args };
};

// ============================================================================
//  Renderers
// ============================================================================

interface RenderedMessage {
  readonly embeds: APIEmbed[];
  readonly components: APIActionRowComponent<APIComponentInMessageActionRow>[];
}

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + "…";

interface MainMessagePayload {
  readonly flags: number;
  readonly components: APIMessageTopLevelComponent[];
}

function buildSelectRow(
  polls: readonly Poll[],
): APIActionRowComponent<APIComponentInMessageActionRow> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(Id.mainMenuSelect)
    .setPlaceholder(
      polls.length === 0 ? "Опросов пока нет" : "Выберите опрос…",
    )
    .setDisabled(polls.length === 0)
    .addOptions(
      (polls.length === 0
        ? [
            new StringSelectMenuOptionBuilder()
              .setValue("__noop__")
              .setLabel("—"),
          ]
        : polls.slice(0, 25).map((p) =>
            new StringSelectMenuOptionBuilder()
              .setValue(p.id)
              .setLabel(truncate(p.title, 100))
              .setDescription(
                p.description.length > 0
                  ? truncate(p.description, 100)
                  : `Вопросов: ${p.questions.length}`,
              ),
          )),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>()
    .addComponents(select)
    .toJSON();
}

function renderMainMessage(
  polls: readonly Poll[],
  headerComponents: readonly APIMessageTopLevelComponent[] | null,
): MainMessagePayload {
  const selectRow = buildSelectRow(polls);

  const baseHeader: readonly APIMessageTopLevelComponent[] =
    headerComponents && headerComponents.length > 0
      ? headerComponents
      : [
          {
            type: ComponentType.TextDisplay,
            content:
              "**Опросы**\n\nЗагрузите шапку через `/exam set-header url:<discohook-url>`.",
          } as APIMessageTopLevelComponent,
        ];

  return {
    flags: MessageFlags.IsComponentsV2,
    components: mergeHeaderWithSelect(baseHeader, selectRow),
  };
}

/**
 * Встраивает select-row внутрь последнего top-level Container'а шапки —
 * чтобы select визуально жил в той же «коробке», что и текст шапки.
 * Если Container'а нет — кладёт select отдельным rom ниже (fallback).
 */
function mergeHeaderWithSelect(
  header: readonly APIMessageTopLevelComponent[],
  selectRow: APIActionRowComponent<APIComponentInMessageActionRow>,
): APIMessageTopLevelComponent[] {
  let lastContainerIdx = -1;
  for (let i = header.length - 1; i >= 0; i--) {
    if (header[i]?.type === ComponentType.Container) {
      lastContainerIdx = i;
      break;
    }
  }

  if (lastContainerIdx === -1) {
    return [...header, selectRow];
  }

  const result = [...header];
  const container = result[lastContainerIdx] as APIMessageTopLevelComponent & {
    type: ComponentType.Container;
    components: APIMessageTopLevelComponent[];
  };
  result[lastContainerIdx] = {
    ...container,
    components: [...container.components, selectRow],
  } as APIMessageTopLevelComponent;
  return result;
}

function renderQuestion(view: QuestionView): RenderedMessage {
  const lines = [
    `**Вопрос ${view.cursor + 1}/${view.total}**`,
    "",
    view.question.text,
  ];
  const currentLine = formatCurrentAnswer(view);
  if (currentLine) lines.push("", currentLine);

  const embed = new EmbedBuilder()
    .setTitle(view.poll.title)
    .setDescription(lines.join("\n"));

  return {
    embeds: [embed.toJSON()],
    components: buildQuestionComponents(view),
  };
}

function formatCurrentAnswer(view: QuestionView): string | null {
  const a = view.currentAnswer;
  if (!a) return null;
  switch (a.kind) {
    case "free":
      return `_Ваш текущий ответ:_ ${truncate(a.text, 200)}`;
    case "single": {
      const opt =
        view.question.kind === "single"
          ? view.question.options.find((o) => o.value === a.value)
          : undefined;
      return `_Ваш текущий ответ:_ ${opt?.label ?? a.value}`;
    }
    case "multi": {
      const options = view.question.kind === "multi" ? view.question.options : [];
      const labels = a.values
        .map((v) => options.find((o) => o.value === v)?.label ?? v)
        .join(", ");
      return `_Ваш текущий ответ:_ ${labels}`;
    }
  }
}

function buildQuestionComponents(
  view: QuestionView,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const rows: APIActionRowComponent<APIComponentInMessageActionRow>[] = [];

  switch (view.question.kind) {
    case "free": {
      const btn = new ButtonBuilder()
        .setCustomId(Id.openModal(view.poll.id, view.question.id))
        .setLabel(view.currentAnswer ? "Изменить ответ" : "Ответить")
        .setStyle(ButtonStyle.Primary);
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(btn).toJSON(),
      );
      break;
    }
    case "single": {
      const current = (view.currentAnswer as SingleAnswer | null)?.value;
      const select = new StringSelectMenuBuilder()
        .setCustomId(Id.singleSelect(view.poll.id, view.question.id))
        .setPlaceholder(current ? "Изменить выбор" : "Выберите вариант")
        .addOptions(
          view.question.options.slice(0, 25).map((o) =>
            new StringSelectMenuOptionBuilder()
              .setValue(o.value)
              .setLabel(truncate(o.label, 100))
              .setDefault(o.value === current),
          ),
        );
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(select)
          .toJSON(),
      );
      break;
    }
    case "multi": {
      const currentValues = new Set(
        (view.currentAnswer as MultiAnswer | null)?.values ?? [],
      );
      const select = new StringSelectMenuBuilder()
        .setCustomId(Id.multiSelect(view.poll.id, view.question.id))
        .setPlaceholder(
          currentValues.size > 0 ? "Изменить выбор" : "Выберите варианты",
        )
        .setMinValues(view.question.min)
        .setMaxValues(Math.min(view.question.max, view.question.options.length))
        .addOptions(
          view.question.options.slice(0, 25).map((o) =>
            new StringSelectMenuOptionBuilder()
              .setValue(o.value)
              .setLabel(truncate(o.label, 100))
              .setDefault(currentValues.has(o.value)),
          ),
        );
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(select)
          .toJSON(),
      );
      break;
    }
  }

  rows.push(buildNavRow(view).toJSON());
  return rows;
}

function buildNavRow(view: QuestionView): ActionRowBuilder<ButtonBuilder> {
  const back = new ButtonBuilder()
    .setCustomId(Id.navBack(view.poll.id))
    .setLabel("Назад")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!view.canGoBack);

  const cancel = new ButtonBuilder()
    .setCustomId(Id.navCancel(view.poll.id))
    .setLabel("Отмена")
    .setStyle(ButtonStyle.Secondary);

  if (view.isLast) {
    const finish = new ButtonBuilder()
      .setCustomId(Id.navFinish(view.poll.id))
      .setLabel("Завершить")
      .setStyle(ButtonStyle.Success)
      .setDisabled(view.currentAnswer === null);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(back, cancel, finish);
  }

  const next = new ButtonBuilder()
    .setCustomId(Id.navNext(view.poll.id))
    .setLabel("Далее")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(view.currentAnswer === null);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(back, cancel, next);
}

function renderAnswerModal(pollId: PollId, question: FreeQuestion): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(MODAL_INPUT)
    .setLabel("Ваш ответ")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);

  return new ModalBuilder()
    .setCustomId(Id.answerModal(pollId, question.id))
    .setTitle("Ответ")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
}

function renderReport(report: SurveyReport): APIEmbed {
  const { poll, session } = report;
  const fields = poll.questions.map((q) => ({
    name: truncate(q.text, 256),
    value: truncate(formatAnswer(q, session.answers[q.id] ?? null), 1024),
  }));
  return new EmbedBuilder()
    .setTitle(`Опрос: ${poll.title}`)
    .setDescription(`Респондент: <@${session.userId}>`)
    .addFields(fields)
    .setTimestamp(report.completedAt)
    .toJSON();
}

function formatAnswer(question: Question, answer: Answer | null): string {
  if (!answer) return "_(нет ответа)_";
  switch (answer.kind) {
    case "free":
      return answer.text;
    case "single":
      return question.kind === "single"
        ? question.options.find((o) => o.value === answer.value)?.label ??
            answer.value
        : answer.value;
    case "multi":
      return question.kind === "multi"
        ? answer.values
            .map(
              (v) => question.options.find((o) => o.value === v)?.label ?? v,
            )
            .join(", ")
        : answer.values.join(", ");
  }
}

// ============================================================================
//  ReportSink
// ============================================================================

export class DiscordReportSink implements ReportSink {
  constructor(
    private readonly client: Client<true>,
    private readonly channelId: string,
  ) {}

  async send(report: SurveyReport): Promise<void> {
    const channel = await this.client.channels.fetch(this.channelId);
    if (!isSendable(channel))
      throw new Error(
        `report channel ${this.channelId} is not a sendable text channel`,
      );
    await channel.send({ embeds: [renderReport(report)] });
  }
}

// ============================================================================
//  Persistent main message
// ============================================================================

export interface MainMessageDeps {
  readonly client: Client<true>;
  readonly store: MainMessageStore;
  readonly headers: HeaderStore;
  readonly channelId: string;
}

export async function buildMainPayload(
  deps: Pick<MainMessageDeps, "headers">,
  polls: readonly Poll[],
): Promise<MainMessagePayload> {
  const header = await deps.headers.get();
  return renderMainMessage(
    polls,
    header ? (header.components as APIMessageTopLevelComponent[]) : null,
  );
}

export async function ensureMainMessage(
  deps: MainMessageDeps,
  polls: readonly Poll[],
): Promise<void> {
  const channel = await deps.client.channels.fetch(deps.channelId);
  if (!isSendable(channel))
    throw new Error(
      `channel ${deps.channelId} is not a sendable text channel`,
    );

  const payload = await buildMainPayload(deps, polls);

  const ref = await deps.store.get();
  if (ref && ref.channelId === deps.channelId) {
    try {
      const existing = await channel.messages.fetch(ref.messageId);
      await existing.edit(payload);
      return;
    } catch (e) {
      if (!(e instanceof DiscordAPIError && e.code === 10008)) throw e;
    }
  }
  const sent = await channel.send(payload);
  await deps.store.set({ channelId: deps.channelId, messageId: sent.id });
}

// ============================================================================
//  Router (interactionCreate -> use cases)
// ============================================================================

export interface RouterDeps {
  readonly useCases: UseCases;
  readonly mainMessageDeps: MainMessageDeps;
  readonly examDeps: ExamCommandDeps;
}

export const registerInteractionRouter = (
  client: Client,
  deps: RouterDeps,
): void => {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await dispatch(interaction, deps);
    } catch (error) {
      console.error("interaction handler failed", error);
      await safeReplyError(interaction);
    }
  });
};

async function dispatch(
  interaction: Interaction,
  deps: RouterDeps,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "exam") return;
    const sub = interaction.options.getSubcommand();
    if (sub === "reload") await handleExamReload(interaction, deps.examDeps);
    else if (sub === "set-header")
      await handleExamSetHeader(interaction, deps.examDeps);
    return;
  }
  if (interaction.isStringSelectMenu()) {
    await routeSelect(interaction, deps);
    return;
  }
  if (interaction.isButton()) {
    await routeButton(interaction, deps.useCases);
    return;
  }
  if (interaction.isModalSubmit()) {
    await routeModal(interaction, deps.useCases);
    return;
  }
}

async function routeSelect(
  i: StringSelectMenuInteraction,
  deps: RouterDeps,
): Promise<void> {
  const uc = deps.useCases;

  if (i.customId === Id.mainMenuSelect) {
    const pollId = i.values[0];
    if (!pollId) {
      await i.deferUpdate();
      return;
    }
    // 1. update() главного сообщения тем же payload — Discord на клиенте
    //    «снимает» текущий выбор в select-меню (известный баг: повторный
    //    клик на ту же опцию иначе не шлёт interaction).
    // 2. followUp() с эфемеркой для самого опроса.
    const polls = await uc.listPolls();
    const payload = await buildMainPayload(deps.mainMessageDeps, polls);
    await i.update(payload);

    const r = await uc.startSurvey({ userId: i.user.id, pollId });
    if (!r.ok) {
      await i.followUp({
        content: "Опрос не найден.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await i.followUp({
      ...renderQuestion(r.value),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parsed = parseId(i.customId);
  if (!parsed || parsed.scope !== "survey") return;
  const [pollId, questionId] = parsed.args;
  if (!pollId || !questionId) return;

  if (parsed.action === "single" || parsed.action === "multi") {
    if (parsed.action === "single" && i.values.length === 0) {
      await i.deferUpdate();
      return;
    }
    const answer: Answer =
      parsed.action === "single"
        ? { kind: "single", value: i.values[0] as string }
        : { kind: "multi", values: i.values };
    const r = await uc.submitAnswer({
      userId: i.user.id,
      pollId,
      questionId,
      answer,
    });
    if (!r.ok) {
      await i.reply({
        content: submitErrorMessage(r.error),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await i.update(renderQuestion(r.value));
  }
}

async function routeButton(
  i: ButtonInteraction,
  uc: UseCases,
): Promise<void> {
  const parsed = parseId(i.customId);
  if (!parsed || parsed.scope !== "survey") return;
  const [pollId, questionId] = parsed.args;
  if (!pollId) return;

  switch (parsed.action) {
    case "open-modal": {
      if (!questionId) return;
      const polls = await uc.listPolls();
      const poll = polls.find((p) => p.id === pollId);
      const question = poll?.questions.find(
        (q): q is FreeQuestion => q.id === questionId && q.kind === "free",
      );
      if (!question) {
        await i.reply({
          content: "Этот вопрос не поддерживает свободный ответ.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await i.showModal(renderAnswerModal(pollId, question));
      return;
    }
    case "nav-back": {
      const r = await uc.goBack({ userId: i.user.id, pollId });
      if (!r.ok) {
        await i.reply({
          content: navErrorMessage(r.error),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await i.update(renderQuestion(r.value));
      return;
    }
    case "nav-next": {
      const r = await uc.goNext({ userId: i.user.id, pollId });
      if (!r.ok) {
        await i.reply({
          content: navErrorMessage(r.error),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await i.update(renderQuestion(r.value));
      return;
    }
    case "nav-finish": {
      const r = await uc.finishSurvey({ userId: i.user.id, pollId });
      if (!r.ok) {
        await i.update({
          content:
            r.error.kind === "incomplete"
              ? `Остались без ответа вопросов: ${r.error.missingCount}.`
              : "Не удалось завершить опрос.",
          embeds: [],
          components: [],
        });
        return;
      }
      await i.update({
        content: "Спасибо! Ваши ответы отправлены.",
        embeds: [],
        components: [],
      });
      return;
    }
    case "nav-cancel": {
      await uc.cancelSurvey({ userId: i.user.id, pollId });
      await i.update({
        content: "Опрос отменён. Прогресс удалён.",
        embeds: [],
        components: [],
      });
      return;
    }
  }
}

async function routeModal(
  i: ModalSubmitInteraction,
  uc: UseCases,
): Promise<void> {
  const parsed = parseId(i.customId);
  if (!parsed || parsed.scope !== "survey" || parsed.action !== "answer-modal")
    return;
  const [pollId, questionId] = parsed.args;
  if (!pollId || !questionId) return;

  const text = i.fields.getTextInputValue(MODAL_INPUT);
  const r = await uc.submitAnswer({
    userId: i.user.id,
    pollId,
    questionId,
    answer: { kind: "free", text },
  });
  if (!r.ok) {
    await i.reply({
      content: submitErrorMessage(r.error),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (i.isFromMessage()) await i.update(renderQuestion(r.value));
  else
    await i.reply({
      ...renderQuestion(r.value),
      flags: MessageFlags.Ephemeral,
    });
}

const submitErrorMessage = (e: {
  kind: string;
  message?: string;
}): string => {
  if (e.kind === "validation" && e.message)
    return `Ответ некорректен: ${e.message}`;
  if (e.kind === "session-not-found")
    return "Сессия не найдена. Откройте опрос из главного меню заново.";
  if (e.kind === "question-mismatch")
    return "Этот вопрос больше неактивен. Откройте опрос из главного меню заново.";
  return "Не удалось сохранить ответ.";
};

const navErrorMessage = (e: string): string => {
  if (e === "session-not-found")
    return "Сессия не найдена. Откройте опрос из главного меню заново.";
  if (e === "current-not-answered") return "Сначала ответьте на текущий вопрос.";
  if (e === "already-first") return "Это первый вопрос.";
  if (e === "already-last") return "Это последний вопрос.";
  return "Не удалось перейти.";
};

async function safeReplyError(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;
  try {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({
      content: "Что-то пошло не так. Попробуйте позже.",
      flags: MessageFlags.Ephemeral,
    });
  } catch {
    // swallow
  }
}

// ============================================================================
//  Slash commands: /exam reload | set-header
// ============================================================================

export const slashCommands: SlashCommandSubcommandsOnlyBuilder[] = [
  new SlashCommandBuilder()
    .setName("exam")
    .setDescription("Управление опросами (только для администраторов)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("reload")
        .setDescription("Перерисовать главное сообщение из текущих данных"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("set-header")
        .setDescription("Загрузить шапку из Discohook URL")
        .addStringOption((opt) =>
          opt
            .setName("url")
            .setDescription("Discohook share URL (?data=... или ?share=...)")
            .setRequired(true),
        ),
    ),
];

export interface ExamCommandDeps {
  readonly client: Client<true>;
  readonly mainMessageDeps: MainMessageDeps;
  readonly useCases: UseCases;
}

async function handleExamReload(
  interaction: ChatInputCommandInteraction,
  deps: ExamCommandDeps,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const polls = await deps.useCases.listPolls();
    await ensureMainMessage(deps.mainMessageDeps, polls);
    await interaction.editReply("Главное сообщение обновлено.");
  } catch (err) {
    await interaction.editReply(`Ошибка: ${(err as Error).message}`);
  }
}

async function handleExamSetHeader(
  interaction: ChatInputCommandInteraction,
  deps: ExamCommandDeps,
): Promise<void> {
  const url = interaction.options.getString("url", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const parsed = await parseDiscohookHeader(url);
    await deps.mainMessageDeps.headers.set({
      components: parsed.components,
      sourceUrl: url,
      updatedAt: new Date().toISOString(),
      updatedBy: interaction.user.id,
    });
    const polls = await deps.useCases.listPolls();
    await ensureMainMessage(deps.mainMessageDeps, polls);
    await interaction.editReply(
      `Шапка обновлена (${parsed.components.length} компонент(ов)).`,
    );
  } catch (err) {
    if (err instanceof DiscohookError) {
      await interaction.editReply(`Discohook: ${err.message}`);
    } else {
      await interaction.editReply(`Ошибка: ${(err as Error).message}`);
    }
  }
}
