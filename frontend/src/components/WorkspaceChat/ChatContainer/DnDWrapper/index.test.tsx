// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Workspace from "@/models/workspace";
import {
  ATTACHMENTS_PROCESSED_EVENT,
  DnDFileUploaderProvider,
  PASTE_ATTACHMENT_EVENT,
  useDndUploader,
} from "./index";

vi.mock("@/models/system", () => ({
  default: { checkDocumentProcessorOnline: async () => true },
}));
vi.mock("@/models/workspace", () => ({
  default: {
    uploadWorkspaceFile: vi.fn(),
    getParsedFiles: vi.fn(),
    maxContextWindowLimit: 0.8,
  },
}));
vi.mock("@/utils/toast", () => ({ default: vi.fn() }));
vi.mock("./FileUploadWarningModal", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderUploader() {
  const root = createRoot(document.createElement("div"));
  let uploader: ReturnType<typeof useDndUploader>;
  function Consumer() {
    uploader = useDndUploader();
    return null;
  }
  flushSync(() =>
    root.render(
      <DnDFileUploaderProvider workspace={{ slug: "test" }}>
        <Consumer />
      </DnDFileUploaderProvider>
    )
  );
  return { read: () => uploader, unmount: () => root.unmount() };
}
afterEach(() => vi.clearAllMocks());

it("keeps a workspace attachment out of the prompt until its path is available", async () => {
  type Result = Awaited<ReturnType<typeof Workspace.uploadWorkspaceFile>>;
  let finish!: (result: Result) => void;
  const pending = new Promise<Result>((resolve) => {
    finish = resolve;
  });
  vi.mocked(Workspace.uploadWorkspaceFile).mockReturnValue(pending);
  const ui = renderUploader();
  try {
    window.dispatchEvent(
      new CustomEvent(PASTE_ATTACHMENT_EVENT, {
        detail: {
          files: [new File(["hello"], "test.txt")],
          destination: "workspace",
        },
      })
    );
    await vi.waitFor(() =>
      expect(ui.read().files[0]?.status).toBe("in_progress")
    );
    expect(ui.read().parseAttachments()).toEqual([]);
    finish({
      response: new Response(),
      data: { file: { path: "test.txt", size: 5 } },
    });
    await vi.waitFor(() =>
      expect(ui.read().parseAttachments()).toEqual([
        {
          name: "test.txt",
          mime: "application/anythingllm-workspace-file",
          contentString: "/workspace/test.txt",
        },
      ])
    );
  } finally {
    ui.unmount();
  }
});

it("releases the input and retains the error if fetching the RAG context fails", async () => {
  vi.mocked(Workspace.getParsedFiles).mockRejectedValue(new Error("offline"));
  const ui = renderUploader();
  const complete = vi.fn();
  window.addEventListener(ATTACHMENTS_PROCESSED_EVENT, complete);
  try {
    window.dispatchEvent(
      new CustomEvent(PASTE_ATTACHMENT_EVENT, {
        detail: { files: [new File(["a"], "a.txt")], destination: "rag" },
      })
    );
    await vi.waitFor(() =>
      expect(ui.read().files[0]).toMatchObject({
        status: "failed",
        error: "offline",
      })
    );
    expect(complete).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(ATTACHMENTS_PROCESSED_EVENT, complete);
    ui.unmount();
  }
});
