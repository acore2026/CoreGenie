const MAX_AGENT_RESOURCE_TRACES = 48;
const SKILL_LIFECYCLE_EVENTS = new Set(["skill_activated", "skill_updated"]);

/**
 * Keep context traces stable while a run progresses. A Skill can emit many
 * activation, resource-read, and script events, but the rail should retain a
 * single bar for that Skill and update it in place.
 */
export function appendResourceTrace(traces, trace) {
  if (!trace) return traces;
  const skillName = trace.kind === "skill" ? trace.titleArgs?.name : null;
  const existing = traces.findIndex(
    (item) =>
      item.id === trace.id ||
      (skillName && item.kind === "skill" && item.titleArgs?.name === skillName)
  );
  if (existing >= 0) {
    return traces.map((item, index) => {
      if (index !== existing) return item;
      if (!skillName) return trace;
      const isLifecycleEvent = SKILL_LIFECYCLE_EVENTS.has(trace.titleKey);
      return {
        ...item,
        id: item.id,
        createdAt: trace.createdAt || item.createdAt,
        titleKey: isLifecycleEvent ? trace.titleKey : item.titleKey,
        titleArgs: trace.titleArgs || item.titleArgs,
        detail: isLifecycleEvent
          ? trace.detail || item.detail
          : item.detail || trace.detail,
      };
    });
  }
  return [...traces, trace].slice(-MAX_AGENT_RESOURCE_TRACES);
}
