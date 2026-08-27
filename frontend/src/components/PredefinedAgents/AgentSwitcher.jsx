import { CaretDown, Check, Robot } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import usePredefinedAgent from "@/hooks/usePredefinedAgent";
import AgentAvatar from "./AgentAvatar";

export default function AgentSwitcher({ disabled = false }) {
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

  if (!agents.length) return null;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-6 max-w-[150px] items-center gap-1.5 rounded-full px-2 text-xs font-medium transition ${
          open
            ? "bg-cyan-300/15 text-cyan-200 light:bg-cyan-100 light:text-cyan-800"
            : "text-zinc-300 hover:bg-zinc-700 hover:text-white light:text-slate-600 light:hover:bg-slate-200"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        aria-label="Switch Agent"
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
        <span className="truncate">
          {selectedAgent?.name || "Default Agent"}
        </span>
        <CaretDown size={11} weight="bold" className="shrink-0" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={menuPosition}
            className="fixed z-[300] max-h-[min(420px,calc(100vh-24px))] w-64 overflow-y-auto rounded-xl border border-white/10 bg-zinc-800 p-1.5 shadow-2xl light:border-slate-200 light:bg-white"
          >
            {agents.map((agent) => (
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
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.07] light:hover:bg-slate-100"
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
