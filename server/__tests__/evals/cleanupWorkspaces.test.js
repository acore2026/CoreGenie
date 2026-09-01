/* eslint-env jest, node */
const {
  loadEnvFile,
  workspaceDeletionRoute,
} = require("../../../evals/agent/scripts/cleanup-workspaces");

describe("evaluation workspace cleanup", () => {
  it("requests a full purge for the exact encoded evaluation workspace", () => {
    expect(workspaceDeletionRoute({ slug: "eval-SA2 KI#18" })).toBe(
      "/v1/workspace/eval-SA2%20KI%2318?purge=true"
    );
  });

  it("loads values containing equals signs from its environment file", () => {
    expect(loadEnvFile("KEY=value=with=equals\n# ignored\nEMPTY=\n")).toEqual({
      KEY: "value=with=equals",
      EMPTY: "",
    });
  });
});
