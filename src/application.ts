import {
  buildReport,
  complete,
  err,
  getQuestionByIndex,
  isLastQuestion,
  moveForward,
  ok,
  parsePoll,
  type Answer,
  type Poll,
  type PollId,
  type Question,
  type QuestionId,
  type Result,
  type Session,
  type SurveyReport,
  type UserId,
  setAnswer,
  startSession,
  totalQuestions,
  validateAnswer,
} from "./domain.ts";

// ============================================================================
//  Ports
// ============================================================================

export interface PollRepository {
  list(): Promise<readonly Poll[]>;
  getById(id: PollId): Promise<Poll | null>;
  save(poll: Poll): Promise<void>;
  delete(id: PollId): Promise<boolean>;
}

export interface SessionRepository {
  findActive(userId: UserId, pollId: PollId): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(userId: UserId, pollId: PollId): Promise<void>;
}

export interface ReportSink {
  send(report: SurveyReport): Promise<void>;
}

/**
 * id главных сообщений в каждом канале. Ключ — channelId,
 * значение — messageId главного embed-сообщения в этом канале.
 */
export type MainMessageMap = Readonly<Record<string, string>>;

export interface MainMessageStore {
  get(): Promise<MainMessageMap>;
  set(channelId: string, messageId: string): Promise<void>;
  remove(channelId: string): Promise<void>;
}

/**
 * Хранит «шапку» главного сообщения — components V2 из Discohook.
 * Тип компонента специально оставлен `unknown[]` на этом слое:
 * application не должен зависеть от discord.js. Инфраструктура
 * (storage / discord) кастует к APIMessageTopLevelComponent[].
 */
export interface HeaderData {
  readonly components: readonly unknown[];
  readonly sourceUrl: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface HeaderStore {
  get(): Promise<HeaderData | null>;
  set(header: HeaderData): Promise<void>;
}

// ============================================================================
//  Views
// ============================================================================

export interface QuestionView {
  readonly kind: "question";
  readonly poll: Poll;
  readonly question: Question;
  readonly cursor: number;
  readonly total: number;
  readonly currentAnswer: Answer | null;
  readonly canGoBack: boolean;
  readonly isLast: boolean;
  readonly session: Session;
}

/**
 * После submitAnswer возможны два исхода: ещё один вопрос или конец опроса.
 * Курсор в submitAnswer теперь автоматически двигается — навигации «назад»
 * у пользователя нет.
 */
export interface FinishedView {
  readonly kind: "finished";
  readonly poll: Poll;
  readonly session: Session;
}

export type SubmitResult = QuestionView | FinishedView;

const buildQuestionView = (poll: Poll, session: Session): QuestionView => {
  const question = getQuestionByIndex(poll, session.cursor);
  if (!question)
    throw new Error(
      `cursor ${session.cursor} out of range for poll "${poll.id}"`,
    );
  return {
    kind: "question",
    poll,
    question,
    cursor: session.cursor,
    total: totalQuestions(poll),
    currentAnswer: session.answers[question.id] ?? null,
    canGoBack: session.cursor > 0,
    isLast: isLastQuestion(poll, session.cursor),
    session,
  };
};

// ============================================================================
//  Use cases
// ============================================================================

export interface UseCaseDeps {
  readonly polls: PollRepository;
  readonly sessions: SessionRepository;
  readonly reports: ReportSink;
}

export type SubmitAnswerError =
  | { readonly kind: "poll-not-found" }
  | { readonly kind: "session-not-found" }
  | { readonly kind: "question-mismatch" }
  | { readonly kind: "validation"; readonly message: string };

export type SavePollError =
  | { readonly kind: "validation"; readonly message: string };

export interface UseCases {
  listPolls(): Promise<readonly Poll[]>;

  savePoll(input: { raw: unknown }): Promise<Result<Poll, SavePollError>>;

  deletePoll(input: { id: PollId }): Promise<{ deleted: boolean }>;

  startSurvey(
    input: { userId: UserId; pollId: PollId },
  ): Promise<Result<QuestionView, "poll-not-found">>;

  /**
   * Принимает ответ. Если был последний вопрос — авто-завершает опрос
   * (отправляет отчёт, удаляет сессию) и возвращает `finished`.
   * Иначе — двигает курсор и возвращает следующий вопрос.
   *
   * Назад вернуться нельзя, переписать ответ нельзя — это экзамен.
   */
  submitAnswer(input: {
    userId: UserId;
    pollId: PollId;
    questionId: QuestionId;
    answer: Answer;
  }): Promise<Result<SubmitResult, SubmitAnswerError>>;
}

export const createUseCases = (deps: UseCaseDeps): UseCases => {
  const { polls, sessions, reports } = deps;

  return {
    listPolls: () => polls.list(),

    async savePoll({ raw }) {
      const parsed = parsePoll(raw);
      if (!parsed.ok)
        return err({ kind: "validation", message: parsed.error });
      await polls.save(parsed.value);
      return ok(parsed.value);
    },

    async deletePoll({ id }) {
      const deleted = await polls.delete(id);
      return { deleted };
    },

    async startSurvey({ userId, pollId }) {
      const poll = await polls.getById(pollId);
      if (!poll) return err("poll-not-found");
      const existing = await sessions.findActive(userId, pollId);
      const session = existing ?? startSession(userId, poll);
      if (!existing) await sessions.save(session);
      return ok(buildQuestionView(poll, session));
    },

    async submitAnswer({ userId, pollId, questionId, answer }) {
      const poll = await polls.getById(pollId);
      if (!poll) return err({ kind: "poll-not-found" });
      const session = await sessions.findActive(userId, pollId);
      if (!session) return err({ kind: "session-not-found" });
      const current = poll.questions[session.cursor];
      if (!current || current.id !== questionId)
        return err({ kind: "question-mismatch" });
      const validated = validateAnswer(current, answer);
      if (!validated.ok)
        return err({ kind: "validation", message: validated.error });

      const withAnswer = setAnswer(session, questionId, validated.value);

      if (isLastQuestion(poll, session.cursor)) {
        // Последний вопрос — завершаем опрос: шлём отчёт, удаляем сессию.
        const completed = complete(withAnswer);
        await reports.send(buildReport(poll, completed));
        await sessions.delete(userId, pollId);
        return ok({ kind: "finished", poll, session: completed });
      }

      const moved = moveForward(withAnswer, poll);
      await sessions.save(moved);
      return ok(buildQuestionView(poll, moved));
    },
  };
};
