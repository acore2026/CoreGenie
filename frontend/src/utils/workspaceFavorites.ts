export function favoritesKey(userId?: string | number | null) {
  return `workspace-favorites:v1:${userId ?? "single-user"}`;
}

export function parseFavorites(raw: string | null): {
  workspaces: number[];
  threads: string[];
} {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      workspaces: [
        ...new Set<number>(
          (Array.isArray(value?.workspaces) ? value.workspaces : []).filter(
            (id: unknown) =>
              typeof id === "number" && Number.isInteger(id) && id > 0
          )
        ),
      ],
      threads: [
        ...new Set<string>(
          (Array.isArray(value?.threads) ? value.threads : []).filter(
            (id: unknown) => typeof id === "string" && id.length < 250
          )
        ),
      ],
    };
  } catch {
    return { workspaces: [], threads: [] };
  }
}

export function threadFavoriteId(
  workspaceId: number | string,
  threadSlug?: string | null
) {
  return `${workspaceId}:${threadSlug || "default"}`;
}

export function favoritesFirst<T>(rows: T[], isFavorite: (row: T) => boolean) {
  return [
    ...rows.filter(isFavorite),
    ...rows.filter((row) => !isFavorite(row)),
  ];
}
