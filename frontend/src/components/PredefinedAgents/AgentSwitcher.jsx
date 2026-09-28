import { CaretDown, Check, Robot } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import usePredefinedAgent from "@/hooks/usePredefinedAgent";
import AgentAvatar from "./AgentAvatar";

export default function AgentSwitcher({ disabled = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 8, bottom: 8 });
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const { agents, selectedAgent, selectedAgentId, selectAgent } =
    usePredefinedAgent();

  useEffect(() => {
    const close = (event) => {
      if (
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 256;
      setMenuPosition({
        left: Math.min(
          Math.max(8, rect.left),
          Math.max(8, window.innerWidth - menuWidth - 8)
        ),
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
      });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open]);

  const visibleAgents = agents.filter((agent) => agent.showInRoster !== false);
  if (!visibleAgents.length) return null;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-7 max-w-[150px] items-center gap-1.5 rounded-md px-2 text-xs font-medium text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary ${
          open
            ? "bg-theme-sidebar-subitem-selected text-theme-text-primary"
            : ""
        } disabled:cursor-not-allowed disabled:opacity-50`}
        aria-label={t("predefined_agents.switch_aria")}
      >
        {selectedAgent ? (
          <AgentAvatar
            agent={selectedAgent}
            size={16}
            className="!rounded-md"
          />
        ) : (
          <Robot size={14} weight="bold" />
        )}
        <span className="truncate">{selectedAgent?.name || "通用助手"}</span>
        <CaretDown size={11} weight="bold" className="shrink-0" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={menuPosition}
            className="dsh-menu fixed z-[300] max-h-[min(420px,calc(100vh-24px))] w-64 overflow-y-auto"
          >
            {visibleAgents.map((agent) => (
              <AgentOption
                key={agent.id}
                agent={agent}
                active={selectedAgentId === agent.id}
                onClick={() => {
                  selectAgent(agent.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

function AgentOption({ agent, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-theme-sidebar-subitem-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary"
    >
      <AgentAvatar agent={agent} size={28} className="!rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-zinc-100 light:text-slate-900">
          {agent.name}
        </span>
        {agent.description && (
          <span className="mt-0.5 block truncate text-[10px] text-zinc-500 light:text-slate-500">
            {agent.description}
          </span>
        )}
      </span>
      {active && <Check size={13} weight="bold" className="text-cyan-300" />}
    </button>
  );
}
