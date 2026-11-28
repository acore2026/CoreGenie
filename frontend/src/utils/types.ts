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
