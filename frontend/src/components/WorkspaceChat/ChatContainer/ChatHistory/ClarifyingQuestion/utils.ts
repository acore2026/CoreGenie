import type { Question, Answer } from "@coregenie/contracts";
export type {
  Question,
  Answer,
  SurveyResult,
  Survey,
} from "@coregenie/contracts";
export interface Draft {
  skipped: boolean;
  value?: string;
  selected?: string | string[] | null;
  otherSelected?: boolean;
  otherText?: string;
}
export type UpdateDraft = (patch: Partial<Draft>) => void;
/**
 * Build the empty draft state for a question. Lives next to the renderers so
 * Header/InputForm/ChoiceForm and the parent stay in sync on shape.
 */
export function emptyDraftFor(question: Question): Draft {
  if (question?.kind === "choice") {
    return {
      skipped: false,
      selected: question.multiSelect ? [] : null,
      otherSelected: false,
      otherText: "",
    };
  }
  return { skipped: false, value: "" };
}

/**
 * Resolve a draft into the canonical { skipped, answer } payload sent on the
 * wire. Empty strings, missing selections and the "Other" option without text
 * all collapse to skipped so the LLM never sees junk.
 */
export function answerForDraft(question: Question, draft?: Draft): Answer {
  if (!draft || draft.skipped) return { skipped: true, answer: null };

  if (question.kind === "input") {
    const trimmed = String(draft.value || "").trim();
    if (!trimmed) return { skipped: true, answer: null };
    return { skipped: false, answer: trimmed };
  }

  if (draft.otherSelected) {
    const trimmed = String(draft.otherText || "").trim();
    if (!trimmed) return { skipped: true, answer: null };
    if (question.multiSelect)
      return {
        skipped: false,
        answer: [
          ...(Array.isArray(draft.selected) ? draft.selected : []),
          trimmed,
        ],
      };
    return { skipped: false, answer: trimmed };
  }

  if (question.multiSelect) {
    const picks = Array.isArray(draft.selected) ? draft.selected : [];
    if (picks.length === 0) return { skipped: true, answer: null };
    return { skipped: false, answer: picks };
  }

  if (!draft.selected) return { skipped: true, answer: null };
  return { skipped: false, answer: draft.selected };
}

/**
 * Render an answer object as the string shown in the post-submit summary
 * (live card and historical chat). `skippedLabel` is passed in so callers can
 * supply a translated string.
 */
export function formatAnswerDisplay(
  answer: Answer | undefined,
  skippedLabel: string
) {
  if (!answer || answer.skipped) return skippedLabel;
  if (Array.isArray(answer.answer)) return answer.answer.join(", ");
  return String(answer.answer ?? "");
}
