import type { Task, AgentRunState } from "./chat/agentRunTypes";

export interface PlanMessage {
  role?: string;
  content?: unknown;
  agentRunId?: string | null;
  type?: string;
  runtime?: { key?: string } | null;
  agentRunState?: Partial<Pick<AgentRunState, "status" | "runtimeKey">> & {
    tasks?: Task[];
  };
}
export function conversationPlanRuns<T extends PlanMessage>(
  history: readonly T[] = []
) {
  const runs = new Map<
    string,
    {
      id: string;
      state: PlanMessage["agentRunState"] | null;
      runtimeKey?: string;
    }
  >();
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

export function planTasks<
  T extends { id: string; budget?: { planOrder?: number } },
>(tasks: T[] = [], runtimeKey?: string | null) {
  return tasks
    .filter((task) =>
      runtimeKey === "default-react"
        ? String(task.id).includes(":plan:")
        : !String(task.id).includes(":plan:")
    )
    .sort((a, b) => (a.budget?.planOrder ?? 0) - (b.budget?.planOrder ?? 0));
}
