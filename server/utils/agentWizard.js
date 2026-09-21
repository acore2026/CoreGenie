// Declarative UI configuration only: no scripts, expressions, or model calls.
function validateWizard(wizard) {
  if (wizard == null) return null;
  const fail = () => {
    throw new Error("任务向导配置无效，请检查字段、选项和显示条件。");
  };
  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  const text = (value, max) =>
    typeof value === "string" && value.trim() && value.length <= max;
  if (
    !object(wizard) ||
    wizard.version !== 1 ||
    !text(wizard.title, 100) ||
    !text(wizard.instructions, 4000) ||
    !Array.isArray(wizard.fields) ||
    !wizard.fields.length ||
    wizard.fields.length > 30 ||
    JSON.stringify(wizard).length > 40000
  )
    fail();
  const seen = new Map();
  for (const field of wizard.fields) {
    if (
      !object(field) ||
      typeof field.id !== "string" ||
      field.id === "constructor" ||
      !/^[a-z][a-z0-9_]{0,39}$/.test(field.id) ||
      seen.has(field.id) ||
      !text(field.label, 150) ||
      !["text", "textarea", "single", "multi"].includes(field.type) ||
      (field.required != null && typeof field.required !== "boolean")
    )
      fail();
    for (const key of ["hint", "placeholder"])
      if (field[key] != null && !text(field[key], 500)) fail();
    if (["single", "multi"].includes(field.type)) {
      if (
        !Array.isArray(field.options) ||
        !field.options.length ||
        field.options.length > 30
      )
        fail();
      const values = new Set();
      for (const option of field.options) {
        if (
          !object(option) ||
          !text(option.value, 80) ||
          !text(option.label, 150) ||
          values.has(option.value)
        )
          fail();
        values.add(option.value);
      }
    } else if (field.options != null) fail();
    if (field.when != null) {
      if (
        !Array.isArray(field.when) ||
        !field.when.length ||
        field.when.length > 10
      )
        fail();
      for (const condition of field.when) {
        const parent = seen.get(condition?.field);
        if (
          !parent ||
          !["single", "multi"].includes(parent.type) ||
          !Array.isArray(condition.values) ||
          !condition.values.length ||
          condition.values.some(
            (value) => !parent.options.some((option) => option.value === value)
          )
        )
          fail();
      }
    }
    seen.set(field.id, field);
  }
  return wizard;
}

module.exports = { validateWizard };
