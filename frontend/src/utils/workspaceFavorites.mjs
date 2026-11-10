export function favoritesKey(userId) {
  return `workspace-favorites:v1:${userId ?? "single-user"}`;
}

export function parseFavorites(raw) {
  try {
    const value = JSON.parse(raw);
    return {
      workspaces: [
        ...new Set(
          (Array.isArray(value?.workspaces) ? value.workspaces : []).filter(
            (id) => Number.isInteger(id) && id > 0
          )
        ),
      ],
      threads: [
        ...new Set(
          (Array.isArray(value?.threads) ? value.threads : []).filter(
            (id) => typeof id === "string" && id.length < 250
          )
        ),
      ],
    };
  } catch {
    return { workspaces: [], threads: [] };
  }
}

export function threadFavoriteId(workspaceId, threadSlug) {
  return `${workspaceId}:${threadSlug || "default"}`;
}

export function favoritesFirst(rows, isFavorite) {
  return [
    ...rows.filter(isFavorite),
    ...rows.filter((row) => !isFavorite(row)),
  ];
}
