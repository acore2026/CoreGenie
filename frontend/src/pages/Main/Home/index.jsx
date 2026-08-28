import React, { useState, useEffect, useRef, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { isMobile } from "react-device-detect";
import { SidebarMobileHeader } from "@/components/Sidebar";
import PromptInput, {
  PROMPT_INPUT_EVENT,
  PROMPT_INPUT_ID,
} from "@/components/WorkspaceChat/ChatContainer/PromptInput";
import DnDFileUploaderWrapper, {
  DndUploaderContext,
  DnDFileUploaderProvider,
  PASTE_ATTACHMENT_EVENT,
} from "@/components/WorkspaceChat/ChatContainer/DnDWrapper";
import { useTranslation } from "react-i18next";
import {
  LAST_VISITED_WORKSPACE,
  PENDING_HELP_DRAFT,
  PENDING_HOME_MESSAGE,
} from "@/utils/constants";
import Workspace from "@/models/workspace";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import { safeJsonParse } from "@/utils/request";
import SuggestedMessages from "@/components/lib/SuggestedMessages";
import useUser from "@/hooks/useUser";
import ChatSettingsMenu from "@/components/WorkspaceChat/ChatContainer/ChatSettingsMenu";
import { ChatTooltips } from "@/components/WorkspaceChat/ChatContainer/ChatTooltips";
import { ChatSidebarProvider } from "@/components/WorkspaceChat/ChatContainer/ChatSidebar";
import MemoriesSidebar from "@/components/WorkspaceChat/ChatContainer/MemoriesSidebar";
import AgentShowcase from "@/components/PredefinedAgents/AgentShowcase";
import usePredefinedAgent from "@/hooks/usePredefinedAgent";
import WorkspaceFilesSidebar from "@/components/WorkspaceChat/ChatContainer/WorkspaceFilesSidebar";
import FirstVisitGuide from "@/components/Help/FirstVisitGuide";

async function getTargetWorkspace() {
  const lastVisited = safeJsonParse(
    localStorage.getItem(LAST_VISITED_WORKSPACE)
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
  const { user } = useUser();
  const [workspace, setWorkspace] = useState(null);
  const [threadSlug, setThreadSlug] = useState(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const pendingFilesRef = useRef([]);

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
          suggestedMessages,
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
      window.dispatchEvent(
        new CustomEvent(PASTE_ATTACHMENT_EVENT, { detail: { files } })
      );
    }
  }, [workspace, threadSlug]);

  // Handle paste events when no thread exists yet
  useEffect(() => {
    if (threadSlug) return;

    async function handlePaste(e) {
      const files = e.detail?.files;
      if (!files?.length) return;

      pendingFilesRef.current = files;
      let ws = workspace;
      if (!ws) {
        ws = await createDefaultWorkspace(t("new-workspace.placeholder"));
        if (!ws) return;
        setWorkspace(ws);
      }
      const { thread } = await Workspace.threads.new(ws.slug);
      if (thread) setThreadSlug(thread.slug);
    }

    window.addEventListener(PASTE_ATTACHMENT_EVENT, handlePaste);
    return () =>
      window.removeEventListener(PASTE_ATTACHMENT_EVENT, handlePaste);
  }, [workspace, threadSlug]);

  async function handleDropWithoutWorkspace(acceptedFiles) {
    setDragging(false);
    pendingFilesRef.current = acceptedFiles;
    const ws = await createDefaultWorkspace(t("new-workspace.placeholder"));
    if (!ws) return;
    setWorkspace(ws);
    const { thread } = await Workspace.threads.new(ws.slug);
    if (thread) setThreadSlug(thread.slug);
  }

  async function handleDropWithWorkspace(acceptedFiles) {
    setDragging(false);
    pendingFilesRef.current = acceptedFiles;
    const { thread } = await Workspace.threads.new(workspace.slug);
    if (thread) setThreadSlug(thread.slug);
  }

  if (workspaceLoading) {
    return (
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="transition-all duration-500 relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-zinc-900 light:bg-white w-full h-full overflow-hidden"
      />
    );
  }

  if (!workspace && user?.role === "default") {
    return <NoWorkspacesAssigned />;
  }

  if (workspace && threadSlug) {
    return (
      <DnDFileUploaderProvider workspace={workspace} threadSlug={threadSlug}>
        <HomeContent
          workspace={workspace}
          setWorkspace={setWorkspace}
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
        onDrop: workspace
          ? handleDropWithWorkspace
          : handleDropWithoutWorkspace,
        parseAttachments: () => [],
      }}
    >
      <HomeContent
        workspace={workspace}
        setWorkspace={setWorkspace}
        threadSlug={null}
        setThreadSlug={setThreadSlug}
      />
    </DndUploaderContext.Provider>
  );
}

function HomeContent({ workspace, setWorkspace, threadSlug, setThreadSlug }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const { files, parseAttachments } = useContext(DndUploaderContext);
  const { selectedAgent } = usePredefinedAgent();

  useEffect(() => {
    const pendingHelpDraft = safeJsonParse(
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
        const textarea = document.getElementById(PROMPT_INPUT_ID);
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

  async function submitMessage(message, attachments = []) {
    if (!message || loading) return;
    setLoading(true);
    try {
      let targetWorkspace = workspace;
      let targetThread = threadSlug;

      if (!targetWorkspace) {
        targetWorkspace = await createDefaultWorkspace(
          t("new-workspace.placeholder")
        );
        if (!targetWorkspace) {
          setLoading(false);
          return;
        }
        setWorkspace(targetWorkspace);
      }

      if (!targetThread) {
        const { thread } = await Workspace.threads.new(targetWorkspace.slug);
        targetThread = thread?.slug;
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

  async function handleSubmit(e) {
    e.preventDefault();
    const currentMessage =
      document.getElementById(PROMPT_INPUT_ID)?.value?.trim() || "";
    await submitMessage(currentMessage, parseAttachments());
  }

  function sendCommand({
    text = "",
    autoSubmit = false,
    writeMode = "replace",
  }) {
    if (autoSubmit) {
      if (writeMode === "append") {
        const currentText =
          document.getElementById(PROMPT_INPUT_ID)?.value ?? "";
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
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative flex w-full h-full z-[2] md:ml-[2px] md:mr-[16px] md:my-[16px] lg:gap-3"
      >
        <div className="relative h-full min-w-0 flex-1">
          <ChatSettingsMenu workspace={workspace} threadSlug={threadSlug} />
          <div className="relative h-full w-full min-w-0 flex-1 overflow-hidden border-none bg-zinc-900 transition-all duration-500 light:bg-white light:border light:border-solid light:border-theme-modal-border md:rounded-[16px]">
            {isMobile && <SidebarMobileHeader />}
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

function NoWorkspacesAssigned() {
  const { t } = useTranslation();
  return (
    <div
      style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
      className="transition-all duration-500 relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-zinc-900 light:bg-white w-full h-full overflow-hidden"
    >
      <div className="flex flex-col h-full w-full items-center justify-center">
        <p className="text-white/60 text-sm text-center whitespace-pre-line">
          {t("home.notAssigned")}
        </p>
      </div>
    </div>
  );
}
