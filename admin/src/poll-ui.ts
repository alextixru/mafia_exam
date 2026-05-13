import type { Option, Question, QuestionKind } from "@shared/poll-schema.ts";
import { genId } from "./utils.ts";

export const KIND_LABEL: Record<QuestionKind, string> = {
  free: "Свободный",
  single: "Один из",
  multi: "Несколько из",
};

export const newOption = (label = "Новый вариант"): Option => ({
  value: genId("o"),
  label,
});

export const newQuestion = (kind: QuestionKind, id: string): Question => {
  if (kind === "free") return { kind: "free", id, text: "" };
  if (kind === "single")
    return {
      kind: "single",
      id,
      text: "",
      options: [newOption("Вариант 1")],
    };
  return {
    kind: "multi",
    id,
    text: "",
    options: [newOption("Вариант 1")],
    min: 1,
    max: 1,
  };
};
