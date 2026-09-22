export function visibleFields(wizard, answers) {
  const visible = new Set();
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

export function wizardTasks(value) {
  return Array.isArray(value)
    ? value
    : value
      ? [{ ...value, id: value.id || "default" }]
      : [];
}

export function updateAnswer(wizard, answers, fieldId, value) {
  const next = { ...answers, [fieldId]: value };
  const changed = new Set([fieldId]);
  for (const field of wizard.fields) {
    if (changed.has(field.groupField) || changed.has(field.meetingField)) {
      delete next[field.id];
      changed.add(field.id);
    }
  }
  return pruneAnswers(wizard, next);
}

export function pruneAnswers(wizard, answers) {
  return Object.fromEntries(
    visibleFields(wizard, answers)
      .filter((field) => Object.hasOwn(answers, field.id))
      .map((field) => [field.id, answers[field.id]])
  );
}

export function fieldValue(field, answer) {
  if (field.type === "meeting") {
    const meetings = field.multiple
      ? Array.isArray(answer)
        ? answer
        : []
      : [answer];
    return meetings
      .filter((item) => item?.label)
      .map(
        (item) => `${item.label}${item.source ? `\n来源：${item.source}` : ""}`
      )
      .join("\n");
  }
  if (field.type === "agenda")
    return Array.isArray(answer)
      ? answer
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

export function maxSelections(field, answers) {
  if (!field?.multiple || !field.maxSelectionsBy) return Infinity;
  return Object.entries(field.maxSelectionsBy).reduce(
    (limit, [fieldId, values]) => {
      const value = answers[fieldId];
      const next = values?.[Array.isArray(value) ? value[0] : value];
      return typeof next === "number" ? Math.min(limit, next) : limit;
    },
    Infinity
  );
}

export function selectionLimitExceeded(field, answers) {
  if (!field?.multiple) return false;
  const count = Array.isArray(answers[field.id]) ? answers[field.id].length : 0;
  return count > maxSelections(field, answers);
}

export function missingFields(wizard, answers) {
  return visibleFields(wizard, answers).filter(
    (field) =>
      (field.required && !fieldValue(field, answers[field.id])) ||
      selectionLimitExceeded(field, answers)
  );
}

export function generatePrompt(wizard, answers) {
  if (missingFields(wizard, answers).length) return null;
  const lines = visibleFields(wizard, answers).flatMap((field) => {
    const value = fieldValue(field, answers[field.id]);
    return value ? [`${field.label}：${value}`] : [];
  });
  return [wizard.instructions.trim(), ...lines].join("\n\n");
}
