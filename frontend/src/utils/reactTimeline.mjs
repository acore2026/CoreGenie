// Keep the final uninterrupted answer outside the folded execution history.
// Never infer success from saved text: only a confirmed completed run folds.
export function completedTimeline(
  parts,
  status,
  fallbackText = "",
  toolCount = 0
) {
  if (status !== "completed") return null;
  if (!parts.length)
    return fallbackText.trim() && toolCount > 0
      ? { history: [], answer: fallbackText }
      : null;
  let lastTool = -1;
  parts.forEach((part, index) => {
    if (part.type === "toolGroup") lastTool = index;
  });
  if (lastTool < 0) return null;
  const answer = parts
    .slice(lastTool + 1)
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("\n\n")
    .trim();
  if (!answer) return null;
  return { history: parts.slice(0, lastTool + 1), answer };
}
