import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import PromptInput, {
  PROMPT_INPUT_EVENT,
  PROMPT_INPUT_ID,
} from "@/components/WorkspaceChat/ChatContainer/PromptInput";
import DnDFileUploaderWrapper, {
  DndUploaderContext,
  useDndUploader,
  DnDFileUploaderProvider,
  PASTE_ATTACHMENT_EVENT,
} from "@/components/WorkspaceChat/ChatContainer/DnDWrapper";
import { useTranslation } from "react-i18next";
import {
  LAST_VISITED_WORKSPACE,
  PENDING_HELP_DRAFT,
  PENDING_HOME_MESSAGE,
} from "@/utils/constants";
import Workspace, { type WorkspaceRecord } from "@/models/workspace";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import { safeJsonParse } from "@/utils/request";
import SuggestedMessages from "@/components/lib/SuggestedMessages";
import CreateWorkspaceGuide from "@/components/CreateWorkspaceGuide";
import ChatSettingsMenu from "@/components/WorkspaceChat/ChatContainer/ChatSettingsMenu";
import { ChatTooltips } from "@/components/WorkspaceChat/ChatContainer/ChatTooltips";
import { ChatSidebarProvider } from "@/components/WorkspaceChat/ChatContainer/ChatSidebar";
import MemoriesSidebar from "@/components/WorkspaceChat/ChatContainer/MemoriesSidebar";
import AgentShowcase from "@/components/PredefinedAgents/AgentShowcase";
import usePredefinedAgent from "@/hooks/usePredefinedAgent";
import WorkspaceFilesSidebar from "@/components/WorkspaceChat/ChatContainer/WorkspaceFilesSidebar";
import type { DropEvent, FileRejection } from "react-dropzone";
import type { ChatCommand } from "@/utils/chat/messages";
import FirstVisitGuide from "@/components/Help/FirstVisitGuide";

type Destination = NonNullable<
  WindowEventMap[typeof PASTE_ATTACHMENT_EVENT]["detail"]["destination"]
>;
const promptElement = () =>
  document.querySelector<HTMLTextAreaElement>(`textarea#${PROMPT_INPUT_ID}`);
async function getTargetWorkspace() {
  const lastVisited = safeJsonParse<{ slug?: string } | null>(
    localStorage.getItem(LAST_VISITED_WORKSPACE),
    null
  );
  if (lastVisited?.slug) {
    const workspace = await Workspace.bySlug(lastVisited.slug);
    if (workspace) return workspace;
  }

  const workspaces = await Workspace.all();
  return workspaces.length > 0 ? workspaces[0] : null;
}

async function createDefaultWorkspace(workspaceName = "My Workspace") {
  const { workspace, message: errorMsg } = await Workspace.new({
    name: workspaceName,
  });
  if (!workspace) {
    showToast(errorMsg || "Failed to create workspace", "error");
    return null;
  }
  return workspace;
}

export default function Home() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null);
  const [threadSlug, setThreadSlug] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const pendingFilesRef = useRef<File[]>([]);
  const pendingDestinationRef = useRef<Destination>("rag");
  const pendingDraftRef = useRef<string | null>(null);

  useEffect(() => {
    async function init() {
      const ws = await getTargetWorkspace();
      if (ws) {
        const [suggestedMessages, { showAgentCommand }] = await Promise.all([
          Workspace.getSuggestedMessages(ws.slug),
          Workspace.agentCommandAvailable(ws.slug),
        ]);
        setWorkspace({
          ...ws,
          suggestedMessages: suggestedMessages ?? [],
          showAgentCommand,
        });
      }
      setWorkspaceLoading(false);
    }
    init();
  }, []);

  // When workspace/thread becomes available and we have pending files, trigger upload
  useEffect(() => {
    if (workspace && threadSlug && pendingFilesRef.current.length > 0) {
      const files = pendingFilesRef.current;
      pendingFilesRef.current = [];
      if (pendingDraftRef.current !== null) {
        window.dispatchEvent(
          new CustomEvent(PROMPT_INPUT_EVENT, {
            detail: { messageContent: pendingDraftRef.current },
          })
        );
        pendingDraftRef.current = null;
      }
      window.dispatchEvent(
        new CustomEvent(PASTE_ATTACHMENT_EVENT, {
          detail: { files, destination: pendingDestinationRef.current },
        })
      );
    }
  }, [workspace, threadSlug]);

  // Handle paste events when no thread exists yet
  useEffect(() => {
    if (threadSlug) return;

    async function handlePaste(
      e: WindowEventMap[typeof PASTE_ATTACHMENT_EVENT]
    ) {
      const files = e.detail?.files;
      if (!files?.length) return;

      pendingFilesRef.current = files;
      pendingDestinationRef.current = e.detail.destination ?? "rag";
      let ws = workspace;
      if (!ws) {
        ws = await createDefaultWorkspace(t("new-workspace.placeholder"));
        if (!ws) return;
        setWorkspace(ws);
      }
      const { thread } = await Workspace.threads.new(ws.slug);
      if (thread) {
        pendingDraftRef.current = promptElement()?.value ?? "";
        setThreadSlug(thread.slug);
      }
    }

    window.addEventListener(PASTE_ATTACHMENT_EVENT, handlePaste);
    return () =>
      window.removeEventListener(PASTE_ATTACHMENT_EVENT, handlePaste);
  }, [workspace, threadSlug]);

  async function handleDrop(
    acceptedFiles: File[],
    _rejected?: FileRejection[],
    event?: DropEvent,
    destination?: Destination
  ) {
    setDragging(false);
    if (!acceptedFiles.length) return;
    pendingDestinationRef.current =
      destination ??
      (event && "type" in event && event.type === "change"
        ? "rag"
        : "conversation");
    pendingFilesRef.current = acceptedFiles;
    const target =
      workspace ??
      (await createDefaultWorkspace(t("new-workspace.placeholder")));
    if (!target) return;
    if (!workspace) setWorkspace(target);
    const { thread } = await Workspace.threads.new(target.slug);
    if (thread) {
      pendingDraftRef.current = promptElement()?.value ?? "";
      setThreadSlug(thread.slug);
    }
  }

  if (workspaceLoading) {
    return (
      <div className="relative min-w-0 flex-1 bg-theme-bg-chat h-full overflow-hidden" />
    );
  }

  if (!workspace) {
    return <NoWorkspaces />;
  }

  if (workspace && threadSlug) {
    return (
      <DnDFileUploaderProvider workspace={workspace} threadSlug={threadSlug}>
        <HomeContent
          workspace={workspace}
          threadSlug={threadSlug}
          setThreadSlug={setThreadSlug}
        />
      </DnDFileUploaderProvider>
    );
  }

  return (
    <DndUploaderContext.Provider
      value={{
        files: [],
        ready: true,
        dragging,
        setDragging,
        onDrop: handleDrop,
        queueWorkspaceFiles: (files) =>
          handleDrop(files, [], undefined, "workspace"),
        parseAttachments: () => [],
      }}
    >
      <HomeContent
        workspace={workspace}
        threadSlug={null}
        setThreadSlug={setThreadSlug}
      />
    </DndUploaderContext.Provider>
  );
}

function HomeContent({
  workspace,
  threadSlug,
  setThreadSlug,
}: {
  workspace: WorkspaceRecord;
  threadSlug: string | null;
  setThreadSlug: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const { files, parseAttachments } = useDndUploader();
  const { selectedAgent } = usePredefinedAgent();

  useEffect(() => {
    const pendingHelpDraft = safeJsonParse<{ prompt?: string } | null>(
      sessionStorage.getItem(PENDING_HELP_DRAFT),
      null
    );
    if (pendingHelpDraft?.prompt) {
      sessionStorage.removeItem(PENDING_HELP_DRAFT);
      window.dispatchEvent(
        new CustomEvent(PROMPT_INPUT_EVENT, {
          detail: {
            messageContent: String(pendingHelpDraft.prompt),
            writeMode: "replace",
          },
        })
      );
      requestAnimationFrame(() => {
        const textarea = promptElement();
        if (!textarea) return;
        textarea.focus();
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
        const end = String(pendingHelpDraft.prompt).length;
        textarea.setSelectionRange(end, end);
      });
      return;
    }

    if (!threadSlug) {
      window.dispatchEvent(
        new CustomEvent(PROMPT_INPUT_EVENT, {
          detail: { messageContent: "", writeMode: "replace" },
        })
      );
    }
  }, []);

  async function submitMessage(
    message: string,
    attachments: ReturnType<typeof parseAttachments> = []
  ) {
    if (!message || loading) return;
    setLoading(true);
    try {
      const targetWorkspace = workspace;
      let targetThread = threadSlug;
      if (!targetThread) {
        const { thread } = await Workspace.threads.new(targetWorkspace.slug);
        targetThread = thread?.slug ?? null;
        if (thread) setThreadSlug(thread.slug);
      }

      sessionStorage.setItem(
        PENDING_HOME_MESSAGE,
        JSON.stringify({ message, attachments })
      );

      if (targetThread) {
        navigate(paths.workspace.thread(targetWorkspace.slug, targetThread));
      } else {
        navigate(paths.workspace.chat(targetWorkspace.slug));
      }
    } catch (error) {
      console.error("Error submitting message:", error);
      showToast("Failed to send message", "error");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    const currentMessage = promptElement()?.value?.trim() || "";
    await submitMessage(currentMessage, parseAttachments());
  }

  function sendCommand({
    text = "",
    autoSubmit = false,
    writeMode = "replace",
  }: ChatCommand) {
    if (autoSubmit) {
      if (writeMode === "append") {
        const currentText = promptElement()?.value ?? "";
        text = currentText + text;
      }
      if (!text.trim()) return;
      submitMessage(text.trim());
      return;
    }
    window.dispatchEvent(
      new CustomEvent(PROMPT_INPUT_EVENT, {
        detail: { messageContent: text, writeMode },
      })
    );
  }

  return (
    <ChatSidebarProvider>
      <div className="relative flex min-w-0 flex-1 h-full z-[2]">
        <div className="relative h-full min-w-0 flex-1">
          <ChatSettingsMenu workspace={workspace} threadSlug={threadSlug} />
          <div className="relative h-full w-full min-w-0 flex-1 overflow-hidden bg-theme-bg-chat">
            <DnDFileUploaderWrapper>
              <div className="flex flex-col h-full w-full items-center justify-center">
                <div className="flex flex-col items-center w-full max-w-[750px]">
                  <h1 className="mb-4 text-center text-xl text-white light:text-slate-900 md:text-2xl">
                    {selectedAgent?.welcomeMessage || t("main-page.greeting")}
                  </h1>
                  <FirstVisitGuide />
                  <PromptInput
                    workspace={workspace}
                    submit={handleSubmit}
                    isStreaming={loading}
                    sendCommand={sendCommand}
                    attachments={files}
                    centered={true}
                    workspaceSlug={workspace?.slug}
                    threadSlug={threadSlug}
                    examplePrompts={selectedAgent?.examplePrompts}
                  />
                  <AgentShowcase />
                </div>
                <SuggestedMessages
                  suggestedMessages={workspace?.suggestedMessages}
                  sendCommand={sendCommand}
                />
              </div>
            </DnDFileUploaderWrapper>
            <ChatTooltips />
          </div>
          <MemoriesSidebar workspace={workspace} />
        </div>
        {workspace && <WorkspaceFilesSidebar workspace={workspace} />}
      </div>
    </ChatSidebarProvider>
  );
}

function NoWorkspaces() {
  return (
    <div className="relative min-w-0 flex-1 bg-theme-bg-chat h-full overflow-y-auto">
      <div className="flex min-h-full w-full items-center justify-center px-5 py-10">
        <div className="w-full max-w-lg">
          <CreateWorkspaceGuide />
        </div>
      </div>
    </div>
  );
}
