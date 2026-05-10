// Изоморфный модуль: используется и в Bun-боте, и в браузерной админке.
// Не импортируй сюда ничего из node:* / bun:* / discord.js / react.

// ============================================================================
//  Result
// ============================================================================

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ============================================================================
//  Poll types
// ============================================================================

export type PollId = string;
export type QuestionId = string;
export type OptionValue = string;

export interface Option {
  readonly value: OptionValue;
  readonly label: string;
}

export interface FreeQuestion {
  readonly kind: "free";
  readonly id: QuestionId;
  readonly text: string;
}
export interface SingleQuestion {
  readonly kind: "single";
  readonly id: QuestionId;
  readonly text: string;
  readonly options: readonly Option[];
}
export interface MultiQuestion {
  readonly kind: "multi";
  readonly id: QuestionId;
  readonly text: string;
  readonly options: readonly Option[];
  readonly min: number;
  readonly max: number;
}
export type Question = FreeQuestion | SingleQuestion | MultiQuestion;

export interface Poll {
  readonly id: PollId;
  readonly title: string;
  readonly description: string;
  readonly questions: readonly Question[];
}

export type QuestionKind = Question["kind"];

// ============================================================================
//  Answer types (shared: бот валидирует входящий ответ, фронт может превью)
// ============================================================================

export interface FreeAnswer {
  readonly kind: "free";
  readonly text: string;
}
export interface SingleAnswer {
  readonly kind: "single";
  readonly value: OptionValue;
}
export interface MultiAnswer {
  readonly kind: "multi";
  readonly values: readonly OptionValue[];
}
export type Answer = FreeAnswer | SingleAnswer | MultiAnswer;

// ============================================================================
//  Helpers
// ============================================================================

export const getQuestionByIndex = (poll: Poll, index: number): Question | null =>
  poll.questions[index] ?? null;

export const isLastQuestion = (poll: Poll, index: number): boolean =>
  index === poll.questions.length - 1;

export const totalQuestions = (poll: Poll): number => poll.questions.length;

// ============================================================================
//  parsePoll — runtime-валидация JSON-структуры
// ============================================================================

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function parsePoll(raw: unknown): Result<Poll, string> {
  if (!isObject(raw)) return err("poll must be an object");
  if (!isNonEmptyString(raw.id)) return err("poll.id must be a non-empty string");
  if (!isNonEmptyString(raw.title)) return err(`poll(${raw.id}).title required`);
  if (typeof raw.description !== "string")
    return err(`poll(${raw.id}).description must be a string`);
  if (!Array.isArray(raw.questions) || raw.questions.length === 0)
    return err(`poll(${raw.id}).questions must be a non-empty array`);

  const questions: Question[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.questions.length; i++) {
    const q = parseQuestion(raw.questions[i], `${raw.id}.questions[${i}]`);
    if (!q.ok) return q;
    if (seen.has(q.value.id))
      return err(`poll(${raw.id}): duplicate question id "${q.value.id}"`);
    seen.add(q.value.id);
    questions.push(q.value);
  }

  return ok({
    id: raw.id,
    title: raw.title,
    description: raw.description,
    questions,
  });
}

function parseQuestion(raw: unknown, path: string): Result<Question, string> {
  if (!isObject(raw)) return err(`${path} must be an object`);
  if (!isNonEmptyString(raw.id)) return err(`${path}.id required`);
  if (!isNonEmptyString(raw.text)) return err(`${path}(${raw.id}).text required`);

  const kind = raw.kind ?? raw.type;
  if (kind === "free") return ok({ kind: "free", id: raw.id, text: raw.text });

  if (kind === "single" || kind === "multi") {
    const options = parseOptions(raw.options, `${path}(${raw.id})`);
    if (!options.ok) return options;

    if (kind === "single") {
      return ok({
        kind: "single",
        id: raw.id,
        text: raw.text,
        options: options.value,
      });
    }

    const min = typeof raw.min === "number" ? raw.min : 1;
    const max = typeof raw.max === "number" ? raw.max : options.value.length;
    if (min < 1) return err(`${path}(${raw.id}).min must be >= 1`);
    if (max < min) return err(`${path}(${raw.id}).max must be >= min`);
    if (max > options.value.length)
      return err(`${path}(${raw.id}).max cannot exceed options length`);

    return ok({
      kind: "multi",
      id: raw.id,
      text: raw.text,
      options: options.value,
      min,
      max,
    });
  }

  return err(`${path}(${raw.id}).type must be free | single | multi`);
}

function parseOptions(raw: unknown, path: string): Result<Option[], string> {
  if (!Array.isArray(raw) || raw.length === 0)
    return err(`${path}.options must be a non-empty array`);

  const seen = new Set<string>();
  const options: Option[] = [];
  for (let i = 0; i < raw.length; i++) {
    const o = raw[i];
    if (!isObject(o)) return err(`${path}.options[${i}] must be an object`);
    if (!isNonEmptyString(o.value))
      return err(`${path}.options[${i}].value required`);
    if (!isNonEmptyString(o.label))
      return err(`${path}.options[${i}].label required`);
    if (seen.has(o.value))
      return err(`${path}.options: duplicate value "${o.value}"`);
    seen.add(o.value);
    options.push({ value: o.value, label: o.label });
  }
  return ok(options);
}

// ============================================================================
//  validateAnswer — нормализация ответа и проверка по схеме вопроса
// ============================================================================

export function validateAnswer(
  question: Question,
  answer: Answer,
): Result<Answer, string> {
  if (question.kind !== answer.kind)
    return err(
      `answer kind mismatch: question is "${question.kind}", got "${answer.kind}"`,
    );

  switch (question.kind) {
    case "free": {
      const text = (answer as FreeAnswer).text.trim();
      if (text.length === 0) return err("answer cannot be empty");
      return ok({ kind: "free", text });
    }
    case "single": {
      const value = (answer as SingleAnswer).value;
      if (!question.options.some((o) => o.value === value))
        return err(`option "${value}" is not allowed for this question`);
      return ok({ kind: "single", value });
    }
    case "multi": {
      const values = (answer as MultiAnswer).values;
      const unique = Array.from(new Set(values));
      if (unique.length !== values.length) return err("duplicate values");
      if (unique.length < question.min)
        return err(`select at least ${question.min}`);
      if (unique.length > question.max)
        return err(`select at most ${question.max}`);
      const allowed = new Set(question.options.map((o) => o.value));
      for (const v of unique) {
        if (!allowed.has(v)) return err(`option "${v}" is not allowed`);
      }
      return ok({ kind: "multi", values: unique });
    }
  }
}
