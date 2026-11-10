export function conversationPlanRuns(history = []) {
  const runs = new Map();
  for (const message of history) {
    if (!message.agentRunId || message.type === "subagentRun") continue;
    const previous = runs.get(message.agentRunId);
    runs.set(message.agentRunId, {
      id: message.agentRunId,
      state: message.agentRunState || previous?.state || null,
      runtimeKey:
        message.agentRunState?.runtimeKey ||
        message.runtime?.key ||
        previous?.runtimeKey,
    });
  }
  return [...runs.values()].reverse();
}

export function planTasks(tasks = [], runtimeKey) {
  return tasks
    .filter((task) =>
      runtimeKey === "default-react"
        ? String(task.id).includes(":plan:")
        : !String(task.id).includes(":plan:")
    )
    .sort((a, b) => (a.budget?.planOrder ?? 0) - (b.budget?.planOrder ?? 0));
}
