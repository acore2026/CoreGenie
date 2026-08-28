/* eslint-env jest, node */
const { contentText, userContent } = require("../../agent-system/message");

describe("Agent message text extraction", () => {
  it("extracts visible text from provider content shapes", () => {
    expect(contentText("plain text")).toBe("plain text");
    expect(contentText({ type: "text", text: "object text" })).toBe(
      "object text"
    );
    expect(contentText({ type: "output_text", content: "output text" })).toBe(
      "output text"
    );
    expect(contentText({ output_text: "response text" })).toBe("response text");
    expect(
      contentText([
        { type: "text_delta", content: "streamed " },
        { text: "answer" },
      ])
    ).toBe("streamed answer");
  });

  it("does not expose reasoning-only metadata as visible text", () => {
    expect(
      contentText({
        type: "reasoning",
        content: "private reasoning",
        reasoning_content: "private reasoning",
      })
    ).toBe("");
  });

  it("adds workspace DOCX paths as text instead of image input", () => {
    expect(
      userContent("转换文件", [
        {
          name: "S2-2600001.docx",
          mime: "application/anythingllm-workspace-file",
          contentString:
            "/workspace/3gpp-markdown/inbox/123/S2-2600001.docx",
        },
      ])
    ).toContain(
      "S2-2600001.docx: /workspace/3gpp-markdown/inbox/123/S2-2600001.docx"
    );
  });
});
