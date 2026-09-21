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

export function pruneAnswers(wizard, answers) {
  return Object.fromEntries(
    visibleFields(wizard, answers)
      .filter((field) => Object.hasOwn(answers, field.id))
      .map((field) => [field.id, answers[field.id]])
  );
}

export function fieldValue(field, answer) {
  if (field.options) {
    const values = Array.isArray(answer) ? answer : [answer];
    return field.options
      .filter((option) => values.includes(option.value))
      .map((option) => option.label)
      .join("、");
  }
  return typeof answer === "string" ? answer.trim().slice(0, 4000) : "";
}

export function missingFields(wizard, answers) {
  return visibleFields(wizard, answers).filter(
    (field) => field.required && !fieldValue(field, answers[field.id])
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
