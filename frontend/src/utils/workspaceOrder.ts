const names = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
const relationRank: Record<string, number> = {
  creator: 0,
  member: 1,
  other: 2,
};

export function orderWorkspaces<
  T extends { id: number | string; name?: string; viewerRelation?: string },
>(workspaces: T[] = []) {
  return [...workspaces].sort(
    (a, b) =>
      (relationRank[a.viewerRelation ?? "other"] ?? 2) -
        (relationRank[b.viewerRelation ?? "other"] ?? 2) ||
      names.compare(a.name || "", b.name || "") ||
      Number(a.id) - Number(b.id)
  );
}
