// Бот-специфичный домен: сессия прохождения опроса + отчёт.
// Типы Poll/Question/Answer/Result + parsePoll/validateAnswer лежат в
// src/shared/poll-schema.ts и шарятся с фронтом.

export * from "./shared/poll-schema.ts";

import {
  isLastQuestion,
  type Answer,
  type Poll,
  type PollId,
  type QuestionId,
} from "./shared/poll-schema.ts";

// ============================================================================
//  Session
// ============================================================================

export type UserId = string;

export type SessionStatus = "active" | "done";

export interface Session {
  readonly userId: UserId;
  readonly pollId: PollId;
  readonly answers: Readonly<Record<QuestionId, Answer>>;
  readonly cursor: number;
  readonly status: SessionStatus;
  readonly startedAt: number;
  readonly updatedAt: number;
}

export const sessionKey = (userId: UserId, pollId: PollId): string =>
  `${userId}:${pollId}`;

const now = (): number => Date.now();

export function startSession(userId: UserId, poll: Poll): Session {
  const t = now();
  return {
    userId,
    pollId: poll.id,
    answers: {},
    cursor: 0,
    status: "active",
    startedAt: t,
    updatedAt: t,
  };
}

export const setAnswer = (
  session: Session,
  questionId: QuestionId,
  answer: Answer,
): Session => ({
  ...session,
  answers: { ...session.answers, [questionId]: answer },
  updatedAt: now(),
});

export const moveForward = (session: Session, poll: Poll): Session =>
  isLastQuestion(poll, session.cursor)
    ? session
    : { ...session, cursor: session.cursor + 1, updatedAt: now() };

export const moveBack = (session: Session): Session =>
  session.cursor === 0
    ? session
    : { ...session, cursor: session.cursor - 1, updatedAt: now() };

export const complete = (session: Session): Session => ({
  ...session,
  status: "done",
  updatedAt: now(),
});

export const isCompleteForPoll = (session: Session, poll: Poll): boolean =>
  poll.questions.every((q) => session.answers[q.id] !== undefined);

// ============================================================================
//  Report
// ============================================================================

export interface SurveyReport {
  readonly poll: Poll;
  readonly session: Session;
  readonly completedAt: number;
}

export const buildReport = (poll: Poll, session: Session): SurveyReport => ({
  poll,
  session,
  completedAt: session.updatedAt,
});
