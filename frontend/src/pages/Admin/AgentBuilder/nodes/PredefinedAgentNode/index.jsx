import { ArrowBendDownRight, UsersThree } from "@phosphor-icons/react";
import AgentAvatar from "@/components/PredefinedAgents/AgentAvatar";
import VariableInput from "../../VariableInput";

export default function PredefinedAgentNode({
  config,
  onConfigChange,
  renderVariableSelect,
  predefinedAgents = [],
}) {
  const selected = predefinedAgents.find(
    (agent) => agent.id === Number(config.agentId)
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.045] p-3.5">
        <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          <UsersThree size={15} weight="duotone" /> Specialist handoff
          <ArrowBendDownRight size={13} className="ml-auto opacity-60" />
        </div>
        <label className="mb-2 block text-sm font-medium text-theme-text-primary">
          Agent
        </label>
        <select
          value={config.agentId || ""}
          onChange={(event) => {
            const agent = predefinedAgents.find(
              (item) => item.id === Number(event.target.value)
            );
            onConfigChange({
              ...config,
              agentId: event.target.value,
              agentName: agent?.name || "",
            });
          }}
          className="w-full rounded-lg border border-white/10 bg-theme-settings-input-bg p-2.5 text-sm text-theme-text-primary outline-none focus:border-cyan-300/50"
        >
          <option value="">Select a custom Agent</option>
          {predefinedAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        {selected && (
          <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-black/10 p-2.5 light:bg-white">
            <AgentAvatar agent={selected} size={34} className="!rounded-lg" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-theme-text-primary">
                {selected.name}
              </p>
              <p className="mt-0.5 line-clamp-1 text-[10px] text-theme-text-secondary">
                {selected.description || "Specialist Agent"}
              </p>
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-theme-text-primary">
          Delegated task
        </label>
        <VariableInput
          multiline
          rows={5}
          value={config.task || ""}
          onChange={(event) =>
            onConfigChange({ ...config, task: event.target.value })
          }
          placeholder="Describe the task, context, constraints, and expected output..."
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-theme-text-primary">
          Result Variable
        </label>
        {renderVariableSelect(
          config.resultVariable,
          (value) => onConfigChange({ ...config, resultVariable: value }),
          "Store the specialist result"
        )}
      </div>
    </div>
  );
}
