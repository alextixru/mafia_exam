import {
  buildReport,
  complete,
  err,
  getQuestionByIndex,
  isCompleteForPoll,
  isLastQuestion,
  moveBack,
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

export interface MainMessageRef {
  readonly channelId: string;
  readonly messageId: string;
}

export interface MainMessageStore {
  get(): Promise<MainMessageRef | null>;
  set(ref: MainMessageRef): Promise<void>;
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

export type FinishError =
  | { readonly kind: "poll-not-found" }
  | { readonly kind: "session-not-found" }
  | { readonly kind: "incomplete"; readonly missingCount: number };

export type NavError =
  | "poll-not-found"
  | "session-not-found"
  | "current-not-answered"
  | "already-first"
  | "already-last";

export type SavePollError =
  | { readonly kind: "validation"; readonly message: string };

export interface UseCases {
  listPolls(): Promise<readonly Poll[]>;

  savePoll(input: { raw: unknown }): Promise<Result<Poll, SavePollError>>;

  deletePoll(input: { id: PollId }): Promise<{ deleted: boolean }>;

  startSurvey(
    input: { userId: UserId; pollId: PollId },
  ): Promise<Result<QuestionView, "poll-not-found">>;

  submitAnswer(input: {
    userId: UserId;
    pollId: PollId;
    questionId: QuestionId;
    answer: Answer;
  }): Promise<Result<QuestionView, SubmitAnswerError>>;

  goNext(input: {
    userId: UserId;
    pollId: PollId;
  }): Promise<Result<QuestionView, NavError>>;

  goBack(input: {
    userId: UserId;
    pollId: PollId;
  }): Promise<Result<QuestionView, NavError>>;

  finishSurvey(input: {
    userId: UserId;
    pollId: PollId;
  }): Promise<Result<{ session: Session }, FinishError>>;

  cancelSurvey(input: { userId: UserId; pollId: PollId }): Promise<void>;
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
      const next = setAnswer(session, questionId, validated.value);
      await sessions.save(next);
      return ok(buildQuestionView(poll, next));
    },

    async goNext({ userId, pollId }) {
      const poll = await polls.getById(pollId);
      if (!poll) return err("poll-not-found");
      const session = await sessions.findActive(userId, pollId);
      if (!session) return err("session-not-found");
      const current = poll.questions[session.cursor];
      if (!current) return err("session-not-found");
      if (session.answers[current.id] === undefined)
        return err("current-not-answered");
      if (isLastQuestion(poll, session.cursor)) return err("already-last");
      const moved = moveForward(session, poll);
      await sessions.save(moved);
      return ok(buildQuestionView(poll, moved));
    },

    async goBack({ userId, pollId }) {
      const poll = await polls.getById(pollId);
      if (!poll) return err("poll-not-found");
      const session = await sessions.findActive(userId, pollId);
      if (!session) return err("session-not-found");
      if (session.cursor === 0) return err("already-first");
      const moved = moveBack(session);
      await sessions.save(moved);
      return ok(buildQuestionView(poll, moved));
    },

    async finishSurvey({ userId, pollId }) {
      const poll = await polls.getById(pollId);
      if (!poll) return err({ kind: "poll-not-found" });
      const session = await sessions.findActive(userId, pollId);
      if (!session) return err({ kind: "session-not-found" });
      if (!isCompleteForPoll(session, poll)) {
        const missingCount = poll.questions.filter(
          (q) => session.answers[q.id] === undefined,
        ).length;
        return err({ kind: "incomplete", missingCount });
      }
      const completed = complete(session);
      await reports.send(buildReport(poll, completed));
      await sessions.delete(userId, pollId);
      return ok({ session: completed });
    },

    async cancelSurvey({ userId, pollId }) {
      await sessions.delete(userId, pollId);
    },
  };
};
