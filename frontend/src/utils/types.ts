export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function castToType(key: string, value: unknown) {
  const definitions: Record<
    string,
    { cast: (value: unknown) => number | null }
  > = {
    openAiTemp: {
      cast: (value) => Number(value),
    },
    openAiHistory: {
      cast: (value) => Number(value),
    },
    similarityThreshold: {
      cast: (value) => parseFloat(String(value)),
    },
    topN: {
      cast: (value) => Number(value),
    },
    router_id: {
      cast: (value) => (value ? Number(value) : null),
    },
  };

  if (!definitions.hasOwnProperty(key)) return value;
  return definitions[key].cast(value);
}

export function workspaceSettingsFromForm(
  form: HTMLFormElement
): Record<string, unknown> {
  return Object.fromEntries(
    Array.from(new FormData(form), ([key, value]) => [
      key,
      castToType(key, value),
    ])
  );
}
