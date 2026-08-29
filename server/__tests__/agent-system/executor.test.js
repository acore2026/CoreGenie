/* eslint-env jest, node */
const {
  applicableCompletionTools,
  artifactOutput,
} = require("../../agent-system/executor");

describe("Agent run completion requirements", () => {
  it("does not require publication for a task that cannot publish", () => {
    expect(
      applicableCompletionTools(
        ["knowledge.publish"],
        [{ allowedToolIds: ["web.search"] }]
      )
    ).toEqual([]);
  });

  it("keeps publication required for a task that can publish", () => {
    expect(
      applicableCompletionTools(
        ["knowledge.publish"],
        [
          {
            allowedToolIds: ["filesystem.write", "knowledge.publish"],
          },
        ]
      )
    ).toEqual(["knowledge.publish"]);
  });

  it("turns a run artifact into a downloadable workspace file", () => {
    expect(
      artifactOutput(
        {
          id: "artifact-1",
          title: "S2-2606085.zip",
          storagePath: "3gpp-markdown/results/run-1.zip",
          metadata: { filename: "S2-2606085.zip" },
        },
        { slug: "playground" },
        { size: 1234 }
      )
    ).toEqual({
      type: "workspaceFile",
      payload: {
        workspaceSlug: "playground",
        path: "3gpp-markdown/results/run-1.zip",
        filename: "S2-2606085.zip",
        fileSize: 1234,
        artifactId: "artifact-1",
      },
    });
  });
});
