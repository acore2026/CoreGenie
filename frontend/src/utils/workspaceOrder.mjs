const names = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
const relationRank = { creator: 0, member: 1, other: 2 };

export function orderWorkspaces(workspaces = []) {
  return [...workspaces].sort(
    (a, b) =>
      (relationRank[a.viewerRelation] ?? 2) -
        (relationRank[b.viewerRelation] ?? 2) ||
      names.compare(a.name || "", b.name || "") ||
      Number(a.id) - Number(b.id)
  );
}
