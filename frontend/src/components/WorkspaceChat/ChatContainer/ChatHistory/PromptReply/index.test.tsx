// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import PromptReply from "./index";
import { ThoughtExpansionProvider } from "../ThoughtContainer";

vi.mock("../Citation", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it("renders every text delta immediately, including the first answer after a thought", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  function render(reply: string) {
    flushSync(() =>
      root.render(
        <ThoughtExpansionProvider>
          <PromptReply uuid="reply" reply={reply} />
        </ThoughtExpansionProvider>
      )
    );
  }
  try {
    render("<think>reading</think>First");
    expect(container.textContent).toContain("First");
    render("<think>reading</think>First and last");
    expect(container.textContent).toContain("First and last");
  } finally {
    root.unmount();
  }
});
