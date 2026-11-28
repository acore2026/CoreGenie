import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { CitationChunk } from "@/utils/chat/messages";
type SidebarType = "sources" | "memories" | "workspaceFiles";
interface SidebarState {
  activeSidebar: SidebarType | null;
  sidebarData: CitationChunk[] | null;
  openSidebar: (type: SidebarType, data?: CitationChunk[] | null) => void;
  toggleSidebar: (type: SidebarType, data?: CitationChunk[] | null) => void;
  closeSidebar: () => void;
}
const ChatSidebarContext = createContext<SidebarState | null>(null);
const emptySources: CitationChunk[] = [];

export function ChatSidebarProvider({ children }: React.PropsWithChildren) {
  const [activeSidebar, setActiveSidebar] = useState<SidebarType | null>(null);
  const [sidebarData, setSidebarData] = useState<CitationChunk[] | null>(null);

  const openSidebar = useCallback(
    (type: SidebarType, data: CitationChunk[] | null = null) => {
      setActiveSidebar(type);
      setSidebarData(data);
    },
    []
  );

  const closeSidebar = useCallback(() => {
    setActiveSidebar(null);
    setSidebarData(null);
  }, []);

  const toggleSidebar = useCallback(
    (type: SidebarType, data: CitationChunk[] | null = null) => {
      if (activeSidebar === type) closeSidebar();
      else openSidebar(type, data);
    },
    [activeSidebar, closeSidebar, openSidebar]
  );

  const contextValue = useMemo(
    () => ({
      activeSidebar,
      sidebarData,
      openSidebar,
      closeSidebar,
      toggleSidebar,
    }),
    [activeSidebar, sidebarData, openSidebar, closeSidebar, toggleSidebar]
  );

  return (
    <ChatSidebarContext.Provider value={contextValue}>
      {children}
    </ChatSidebarContext.Provider>
  );
}

export function useChatSidebar() {
  return useContext(ChatSidebarContext);
}

function useSidebarState() {
  const state = useChatSidebar();
  if (!state)
    throw new Error("Chat sidebar controls require ChatSidebarProvider");
  return state;
}
export function useSourcesSidebar() {
  const { activeSidebar, sidebarData, openSidebar, closeSidebar } =
    useSidebarState();
  return {
    sidebarOpen: activeSidebar === "sources",
    sources:
      activeSidebar === "sources"
        ? (sidebarData ?? emptySources)
        : emptySources,
    openSidebar: (sources: CitationChunk[]) => openSidebar("sources", sources),
    closeSidebar,
  };
}

export function useMemoriesSidebar() {
  const { activeSidebar, toggleSidebar, closeSidebar } = useSidebarState();
  return {
    sidebarOpen: activeSidebar === "memories",
    toggleSidebar: () => toggleSidebar("memories"),
    closeSidebar,
  };
}

export function useWorkspaceFilesSidebar() {
  const { activeSidebar, toggleSidebar, closeSidebar } = useSidebarState();
  return {
    sidebarOpen: activeSidebar === "workspaceFiles",
    toggleSidebar: () => toggleSidebar("workspaceFiles"),
    closeSidebar,
  };
}

/**
 * Reusable animation wrapper for right-side chat panels.
 * Uses a fixed-width wrapper + GPU-composited translateX so opening/closing
 * never triggers layout recalculation on the chat history (which can have
 * 500+ message nodes).
 */
export default function ChatSidebar({
  isOpen,
  children,
}: React.PropsWithChildren<{ isOpen: boolean }>) {
  return (
    <div
      className="absolute right-0 top-0 z-40 h-full overflow-hidden"
      style={{
        width: isOpen ? "366px" : "0px",
        transition: "width 400ms cubic-bezier(0.4,0,0.2,1)",
        willChange: isOpen ? "width" : "auto",
        contain: "strict",
        pointerEvents: isOpen ? "auto" : "none",
      }}
    >
      <div
        className="h-full"
        style={{
          width: "366px",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 400ms cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
