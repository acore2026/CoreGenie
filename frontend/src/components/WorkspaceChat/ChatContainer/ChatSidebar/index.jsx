import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const ChatSidebarContext = createContext();

export function ChatSidebarProvider({ children }) {
  const [activeSidebar, setActiveSidebar] = useState(null);
  const [sidebarData, setSidebarData] = useState(null);

  const openSidebar = useCallback((type, data = null) => {
    setActiveSidebar(type);
    setSidebarData(data);
  }, []);

  const closeSidebar = useCallback(() => {
    setActiveSidebar(null);
    setSidebarData(null);
  }, []);

  const toggleSidebar = useCallback(
    (type, data = null) => {
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

export function useSourcesSidebar() {
  const { activeSidebar, sidebarData, openSidebar, closeSidebar } =
    useContext(ChatSidebarContext);
  return {
    sidebarOpen: activeSidebar === "sources",
    sources: activeSidebar === "sources" ? sidebarData : [],
    openSidebar: (sources) => openSidebar("sources", sources),
    closeSidebar,
  };
}

export function useMemoriesSidebar() {
  const { activeSidebar, toggleSidebar, closeSidebar } =
    useContext(ChatSidebarContext);
  return {
    sidebarOpen: activeSidebar === "memories",
    toggleSidebar: () => toggleSidebar("memories"),
    closeSidebar,
  };
}

export function useWorkspaceFilesSidebar() {
  const { activeSidebar, toggleSidebar, closeSidebar } =
    useContext(ChatSidebarContext);
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
export default function ChatSidebar({ isOpen, children }) {
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
