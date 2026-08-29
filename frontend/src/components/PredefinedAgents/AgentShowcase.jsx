import { Check, Plus } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import useUser from "@/hooks/useUser";
import usePredefinedAgent from "@/hooks/usePredefinedAgent";
import paths from "@/utils/paths";
import AgentAvatar from "./AgentAvatar";

export default function AgentShowcase() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { agents, loading, selectedAgentId, selectAgent } =
    usePredefinedAgent();
  const visibleAgents = agents.filter((agent) => !agent.isBuiltinDefault);

  if (loading) return <div className="h-[104px]" />;
  if (!visibleAgents.length && user?.role !== "admin") return null;

  return (
    <section className="mt-5 w-[95vw] max-w-[750px]" aria-label="Agents">
      <div className="mb-2.5 flex items-end justify-between px-1">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80 light:text-cyan-700">
            Agent roster
          </p>
          <p className="mt-0.5 text-sm text-zinc-400 light:text-slate-500">
            选择一个专属 Agent 开始对话
          </p>
        </div>
        {user?.role === "admin" && (
          <button
            type="button"
            onClick={() => navigate(paths.settings.agents())}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-white light:text-slate-500 light:hover:bg-slate-100 light:hover:text-slate-900"
          >
            <Plus size={13} weight="bold" /> 管理
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 pb-2">
        {visibleAgents.map((agent) => {
          const active = selectedAgentId === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => selectAgent(agent.id)}
              className={`group relative flex w-full min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-all ${
                active
                  ? "border-cyan-300/45 bg-cyan-300/[0.08] shadow-[0_8px_28px_rgba(34,211,238,0.08)] light:border-cyan-500/40 light:bg-cyan-50"
                  : "border-white/[0.08] bg-white/[0.035] hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06] light:border-slate-200 light:bg-slate-50 light:hover:border-slate-300 light:hover:bg-white"
              }`}
            >
              <AgentAvatar agent={agent} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block line-clamp-2 text-sm font-semibold leading-4 text-zinc-100 light:text-slate-900">
                  {agent.name}
                </span>
                <span className="mt-1 block line-clamp-2 text-xs leading-4 text-zinc-500 light:text-slate-500">
                  {agent.description || "Ready to help"}
                </span>
              </span>
              {active && (
                <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-300 text-zinc-950">
                  <Check size={10} weight="bold" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
