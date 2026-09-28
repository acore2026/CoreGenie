// Declarative UI configuration only: no scripts, expressions, or model calls.
function validateWizard(wizard) {
  if (wizard == null) return null;
  if (Array.isArray(wizard)) {
    if (wizard.length > 12 || JSON.stringify(wizard).length > 180000)
      throw new Error(
        "最多配置 12 个快捷任务，配置总长度不能超过 180000 字符。"
      );
    const ids = new Set();
    for (const task of wizard) {
      if (
        !task ||
        Array.isArray(task) ||
        typeof task.id !== "string" ||
        !/^[a-z][a-z0-9_-]{0,39}$/.test(task.id) ||
        ids.has(task.id)
      )
        throw new Error("快捷任务需要不重复的 id。");
      ids.add(task.id);
      validateWizard(task);
    }
    return wizard;
  }
  const fail = () => {
    throw new Error("快捷任务配置无效，请检查字段、选项和显示条件。");
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
  if (wizard.description != null && !text(wizard.description, 500)) fail();
  for (const field of wizard.fields) {
    if (
      !object(field) ||
      typeof field.id !== "string" ||
      field.id === "constructor" ||
      !/^[a-z][a-z0-9_]{0,39}$/.test(field.id) ||
      seen.has(field.id) ||
      !text(field.label, 150) ||
      !["text", "textarea", "single", "multi", "meeting", "agenda"].includes(
        field.type
      ) ||
      (field.required != null && typeof field.required !== "boolean")
    )
      fail();
    for (const key of ["hint", "placeholder"])
      if (field[key] != null && !text(field[key], 500)) fail();
    if (
      field.multiple != null &&
      (field.type !== "meeting" || typeof field.multiple !== "boolean")
    )
      fail();
    if (field.maxSelectionsBy != null) {
      if (!object(field.maxSelectionsBy) || !field.multiple) fail();
      for (const [parentId, limits] of Object.entries(field.maxSelectionsBy)) {
        const parent = seen.get(parentId);
        if (parent?.type !== "single" || !object(limits)) fail();
        for (const [option, limit] of Object.entries(limits)) {
          if (
            !parent.options.some((item) => item.value === option) ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 999
          )
            fail();
        }
      }
    }
    if (
      field.examples != null &&
      (!Array.isArray(field.examples) ||
        field.examples.length > 4 ||
        field.examples.some((example) => !text(example, 500)))
    )
      fail();
    if (["meeting", "agenda"].includes(field.type)) {
      const group = seen.get(field.groupField);
      if (group?.type !== "single") fail();
      const groups = require("./threeGppCatalog").GROUPS;
      if (group.options.some((option) => !groups.includes(option.value)))
        fail();
      if (
        field.type === "agenda" &&
        (seen.get(field.meetingField)?.type !== "meeting" ||
          seen.get(field.meetingField).groupField !== field.groupField)
      )
        fail();
    }
    if (["single", "multi"].includes(field.type)) {
      const optionGroupIds = new Set();
      if (field.optionGroups != null) {
        if (
          !Array.isArray(field.optionGroups) ||
          !field.optionGroups.length ||
          field.optionGroups.length > 10
        )
          fail();
        for (const group of field.optionGroups) {
          if (
            !object(group) ||
            typeof group.id !== "string" ||
            !/^[a-z][a-z0-9_-]{0,39}$/.test(group.id) ||
            optionGroupIds.has(group.id) ||
            !text(group.label, 100) ||
            (group.description != null && !text(group.description, 300)) ||
            (group.collapsed != null && typeof group.collapsed !== "boolean")
          )
            fail();
          optionGroupIds.add(group.id);
        }
      }
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
        if (option.description != null && !text(option.description, 500))
          fail();
        if (
          (field.optionGroups && !optionGroupIds.has(option.group)) ||
          (!field.optionGroups && option.group != null)
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
