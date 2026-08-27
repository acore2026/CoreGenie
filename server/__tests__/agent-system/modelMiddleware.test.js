/* eslint-env jest, node */
const { AIMessage } = require("@langchain/core/messages");
const {
  isReasoningOnly,
  reasoningOnlyFallbackMiddleware,
} = require("../../agent-system/modelMiddleware");

describe("reasoning-only model fallback", () => {
  it("recognizes a hidden-reasoning response with no visible answer", () => {
    expect(
      isReasoningOnly(
        new AIMessage({
          content: "",
          additional_kwargs: { reasoning_content: "unfinished reasoning" },
        })
      )
    ).toBeTruthy();
    expect(isReasoningOnly(new AIMessage("visible answer"))).toBeFalsy();
  });

  it("retries only the empty reasoning response with thinking disabled", async () => {
    const fallbackModel = { id: "thinking-disabled" };
    const middleware = reasoningOnlyFallbackMiddleware(() => fallbackModel);
    const handler = jest
      .fn()
      .mockResolvedValueOnce(
        new AIMessage({
          content: "",
          additional_kwargs: { reasoning_content: "unfinished reasoning" },
        })
      )
      .mockResolvedValueOnce(new AIMessage("final answer"));

    const result = await middleware.wrapModelCall(
      { model: { id: "primary" } },
      handler
    );
    expect(result.content).toBe("final answer");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].model).toBe(fallbackModel);
  });
});
