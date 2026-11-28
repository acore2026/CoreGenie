import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import {
  elapsed,
  stateFromSnapshot,
  toolName,
} from "@/components/WorkspaceChat/ChatContainer/ChatHistory/AgentExecutionRail/types";
import {
  formatSize,
  includesPath,
  parentDirectory,
} from "@/components/WorkspaceChat/ChatContainer/WorkspaceFilesSidebar/types";

describe("TanStack Query setup", () => {
  it("builds stable query keys and client defaults", () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(
      false
    );
    expect(queryKeys.predefinedAgents.all).toEqual(["predefinedAgents"]);
    expect(queryKeys.workspaces.list("1:tok:admin")).toEqual([
      "workspaces",
      "list",
      "1:tok:admin",
    ]);
    expect(queryKeys.agentRuns.snapshot("run-42")).toEqual([
      "agentRuns",
      "snapshot",
      "run-42",
    ]);
  });
});

describe("AgentExecutionRail helpers", () => {
  it("formats elapsed durations and tool names", () => {
    expect(elapsed(undefined, undefined, 1000)).toBeNull();
    expect(elapsed("2026-01-01T00:00:00Z", "2026-01-01T00:00:45Z", 0)).toBe(
      "45s"
    );
    expect(elapsed("2026-01-01T00:00:00Z", "2026-01-01T00:02:05Z", 0)).toBe(
      "2m 5s"
    );
    expect(toolName("3gpp.download_proposals")).toBe("download proposals");
  });

  it("rebuilds rail state from a completed snapshot", () => {
    const state = stateFromSnapshot({
      run: {
        id: "run-1",
        status: "completed",
        phase: "done",
        runtimeKey: "default-react",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:10Z",
      },
      events: [],
      tasks: [],
      evidence: [],
      toolExecutions: [],
    });
    expect(state?.status).toBe("completed");
    expect(state?.activities?.[0]?.summaryKey).toBe("run_completed");
  });
});

describe("WorkspaceFilesSidebar helpers", () => {
  it("formats byte sizes and path hierarchy helpers", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(15 * 1024 * 1024)).toBe("15 MB");
    expect(parentDirectory("docs/3gpp/report.md")).toBe("docs/3gpp");
    expect(parentDirectory("report.md")).toBe("");
    expect(includesPath("docs/3gpp", "docs/3gpp/report.md")).toBe(true);
    expect(includesPath("docs/3gpp", "docs/3gpp-other/report.md")).toBe(false);
  });
});
