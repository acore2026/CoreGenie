export interface WizardField {
  id: string;
  label?: string;
  type?: string;
  multiple?: boolean;
  required?: boolean;
  when?: { field: string; values: string[] }[];
  groupField?: string;
  meetingField?: string;
  options?: { value: string; label: string; group?: string }[];
  optionGroups?: { id: string; collapsed?: boolean }[];
  maxSelectionsBy?: Record<string, Record<string, number>>;
}
export interface Wizard {
  fields: WizardField[];
  instructions: string;
}
type Answers = Record<string, unknown>;
type Form = Pick<Wizard, "fields">;
function itemValues(
  value: unknown
): value is { label: string; source?: string; description?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
  );
}
export function visibleFields(wizard: Form, answers: Answers) {
  const visible = new Set<string>();
  return wizard.fields.filter((field) => {
    const matches = (field.when || []).every((condition) => {
      if (!visible.has(condition.field)) return false;
      const value = answers[condition.field];
      return condition.values.some((expected) =>
        Array.isArray(value) ? value.includes(expected) : value === expected
      );
    });
    if (matches) visible.add(field.id);
    return matches;
  });
}

export function wizardTasks<T extends { id?: string; title?: string }>(
  value: T
): (T & { id: string })[];
export function wizardTasks<T extends { id?: string; title?: string }>(
  value: T[] | null | undefined
): T[];
export function wizardTasks<T extends { id?: string; title?: string }>(
  value: T | T[] | null | undefined
) {
  return Array.isArray(value)
    ? value
    : value
      ? [{ ...value, id: value.id || "default" }]
      : [];
}

export function updateAnswer(
  wizard: Form,
  answers: Answers,
  fieldId: string,
  value: unknown
) {
  const next = { ...answers, [fieldId]: value };
  const changed = new Set([fieldId]);
  for (const field of wizard.fields) {
    if (
      (field.groupField && changed.has(field.groupField)) ||
      (field.meetingField && changed.has(field.meetingField))
    ) {
      delete next[field.id];
      changed.add(field.id);
    }
  }
  return pruneAnswers(wizard, next);
}

export function pruneAnswers(wizard: Form, answers: Answers): Answers {
  return Object.fromEntries(
    visibleFields(wizard, answers)
      .filter((field) => Object.hasOwn(answers, field.id))
      .map((field) => [field.id, answers[field.id]])
  );
}

export function fieldValue(field: WizardField, answer: unknown) {
  if (field.type === "meeting") {
    const meetings = field.multiple
      ? Array.isArray(answer)
        ? answer
        : []
      : [answer];
    return meetings
      .filter(itemValues)
      .filter((item) => item.label)
      .map(
        (item) => `${item.label}${item.source ? `\n来源：${item.source}` : ""}`
      )
      .join("\n");
  }
  if (field.type === "agenda")
    return Array.isArray(answer)
      ? answer
          .filter(itemValues)
          .map(
            (item) =>
              `${item.label}${item.description ? `（${item.description}）` : ""}${item.source ? `\n来源：${item.source}` : ""}`
          )
          .join("\n")
      : "";
  if (field.options) {
    const values = Array.isArray(answer) ? answer : [answer];
    return field.options
      .filter((option) => values.includes(option.value))
      .map((option) => option.label)
      .join("、");
  }
  return typeof answer === "string" ? answer.trim().slice(0, 4000) : "";
}

export function maxSelections(field: WizardField, answers: Answers) {
  if (!field?.multiple || !field.maxSelectionsBy) return Infinity;
  return Object.entries(field.maxSelectionsBy).reduce(
    (limit, [fieldId, values]) => {
      const value = answers[fieldId];
      const choice: unknown = Array.isArray(value) ? value[0] : value;
      const next = typeof choice === "string" ? values[choice] : undefined;
      return typeof next === "number" ? Math.min(limit, next) : limit;
    },
    Infinity
  );
}

export function selectionLimitExceeded(field: WizardField, answers: Answers) {
  if (!field?.multiple) return false;
  const value = answers[field.id];
  const count = Array.isArray(value) ? value.length : 0;
  return count > maxSelections(field, answers);
}

export function missingFields(wizard: Form, answers: Answers) {
  return visibleFields(wizard, answers).filter(
    (field) =>
      (field.required && !fieldValue(field, answers[field.id])) ||
      selectionLimitExceeded(field, answers)
  );
}

export function generatePrompt(wizard: Wizard, answers: Answers) {
  if (missingFields(wizard, answers).length) return null;
  const lines = visibleFields(wizard, answers).flatMap((field) => {
    const value = fieldValue(field, answers[field.id]);
    return value ? [`${field.label}：${value}`] : [];
  });
  return [wizard.instructions.trim(), ...lines].join("\n\n");
}
