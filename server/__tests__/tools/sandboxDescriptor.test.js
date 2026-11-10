/* eslint-env jest, node */
jest.mock("../../utils/agents/aibitat/plugins/sandbox/lib", () => ({
  run: jest.fn(),
}));

const sandboxClient = require("../../utils/agents/aibitat/plugins/sandbox/lib");
const { bash } = require("../../tools/sandbox");

describe("sandbox descriptor broker failures", () => {
  beforeEach(() => jest.clearAllMocks());

  it("allows long conversions and retains an explicit execution deadline", () => {
    expect(bash.schema.parse({ code: "echo ready" }).timeout_seconds).toBe(900);
    expect(
      bash.schema.safeParse({ code: "echo ready", timeout_seconds: 7200 })
        .success
    ).toBe(true);
    expect(
      bash.schema.safeParse({ code: "echo ready", timeout_seconds: 7201 })
        .success
    ).toBe(false);
  });

  it("returns a retryable result when broker capacity is busy", async () => {
    sandboxClient.run.mockRejectedValue(
      Object.assign(new Error("sandbox capacity is busy; retry shortly"), {
        code: "SANDBOX_BUSY",
        retryable: true,
      })
    );

    const result = await bash.execute(
      {
        code: "echo ready",
        timeout_seconds: 30,
        cwd: "/workspace",
      },
      {
        workspace: { id: 2 },
        run: { id: "03b7e8e4-8566-472a-b11a-4c8e1673a68c" },
        activatedSkill: jest.fn(),
        emit: jest.fn(),
      }
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SANDBOX_BUSY",
      retryable: true,
    });
  });
});
