import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  FolderOpen,
  Globe,
  NotePencil,
  Plus,
  Robot,
  Sparkle,
} from "@phosphor-icons/react";
import PredefinedAgent from "@/models/predefinedAgent";
import AgentAvatar from "@/components/PredefinedAgents/AgentAvatar";
import showToast from "@/utils/toast";
import Workspace from "@/models/workspace";
import ConfigSyncPanel from "../ConfigSyncPanel";
import QuickTaskEditor from "./QuickTaskEditor";
import DisplayOrder from "@/components/DisplayOrder";
import { inputClass } from "./Controls";
import AgentEditor from "./AgentEditor";
import SkillEditor from "./SkillEditor";
import ModelCapabilityRegistry from "./ModelCapabilityRegistry";
import type { AdminData, Skill } from "@/models/predefinedAgentTypes";
import type { Editor, Scope } from "./types";

export default function PredefinedAgentManager({ view = "agents" }) {
  const { t } = useTranslation();
  const [data, setData] = useState<AdminData>({
    agents: [],
    skills: [],
    quickTasks: [],
    tools: [],
    runtimes: [],
    modelCapabilities: [],
    defaultAgentId: null,
  });
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [skillScope, setSkillScope] = useState<Scope>("global");
  const [workspaces, setWorkspaces] = useState<
    { id: number; name: string; slug: string }[]
  >([]);
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [workspaceSkills, setWorkspaceSkills] = useState<Skill[]>([]);
  const showingSkills = view === "skills";
  const showingQuickTasks = view === "quick-tasks";

  async function refresh() {
    const [next, availableWorkspaces] = await Promise.all([
      PredefinedAgent.adminList(),
      showingSkills ? Workspace.all() : Promise.resolve([]),
    ]);
    if ("error" in next) showToast(next.error, "error");
    else setData(next);
    if (showingSkills) {
      setWorkspaces(availableWorkspaces);
      setWorkspaceSlug(
        (current) => current || availableWorkspaces[0]?.slug || ""
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    setEditor(null);
    setLoading(true);
    refresh();
  }, [view]);

  useEffect(() => {
    if (!showingSkills || !workspaceSlug) {
      setWorkspaceSkills([]);
      return;
    }
    let active = true;
    PredefinedAgent.workspaceSkills(workspaceSlug).then((result) => {
      if (!active) return;
      if (result.error) showToast(result.error, "error");
      setWorkspaceSkills(result.skills || []);
    });
    return () => {
      active = false;
    };
  }, [showingSkills, workspaceSlug]);

  const visibleSkills =
    skillScope === "workspace" ? workspaceSkills : data.skills;
  const runtimeLabels = useMemo(
    () =>
      Object.fromEntries(
        data.runtimes.map((runtime) => [runtime.key, runtime.label])
      ),
    [data.runtimes]
  );

  async function setDefaultAgent(event: React.ChangeEvent<HTMLSelectElement>) {
    const agentId = Number(event.target.value);
    const result = await PredefinedAgent.setDefault(agentId);
    if (!result.success)
      return showToast(result.error || "设置默认 Agent 失败", "error");
    setData((current) => ({ ...current, defaultAgentId: agentId }));
    showToast("全局默认 Agent 已更新", "success");
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-theme-bg-secondary text-theme-text-primary">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-6 py-4 light:border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            {showingSkills ? (
              <Sparkle size={22} weight="duotone" className="text-amber-300" />
            ) : showingQuickTasks ? (
              <FileText size={22} className="text-theme-text-secondary" />
            ) : (
              <Robot size={22} weight="duotone" className="text-cyan-300" />
            )}
            <h1 className="text-lg font-semibold">
              {showingSkills
                ? "Skills"
                : showingQuickTasks
                  ? t("quick_tasks.title")
                  : "Predefined Agents"}
            </h1>
          </div>
          <p className="mt-1 text-xs text-theme-text-secondary">
            {showingSkills
              ? "创建可被多个 Agent 复用的专业知识与行为指令。"
              : showingQuickTasks
                ? t("quick_tasks.description")
                : "为不同任务配置独立的身份、Skill、工具权限和开场白。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!showingSkills && (
            <DisplayOrder
              key={view}
              kind={showingQuickTasks ? "quick-tasks" : "agents"}
              items={showingQuickTasks ? data.quickTasks : data.agents}
              onSaved={refresh}
              disabled={loading}
            />
          )}
          {showingSkills ? (
            <button
              type="button"
              onClick={() =>
                setEditor({ type: "skill", item: null, scope: skillScope })
              }
              className="flex h-9 items-center gap-1.5 rounded-xl bg-amber-300 px-3 text-xs font-semibold text-zinc-950 transition hover:bg-amber-200"
            >
              <Plus size={14} weight="bold" /> 新建 Skill
            </button>
          ) : showingQuickTasks ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => setEditor({ type: "quick-task", item: null })}
              className="dsh-control min-h-[40px] px-3 text-sm hover:bg-theme-sidebar-subitem-hover focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-50"
            >
              {t("quick_tasks.create")}
            </button>
          ) : (
            <>
              <label className="flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs text-theme-text-secondary light:border-slate-200">
                <span className="whitespace-nowrap">全局默认</span>
                <select
                  aria-label="Global default Agent"
                  value={data.defaultAgentId || ""}
                  onChange={setDefaultAgent}
                  disabled={
                    loading ||
                    !data.agents.some(
                      (agent) => agent.enabled && agent.showInRoster !== false
                    )
                  }
                  className="max-w-40 bg-transparent font-medium text-theme-text-primary outline-none"
                >
                  {!data.defaultAgentId && (
                    <option value="" disabled>
                      未设置
                    </option>
                  )}
                  {data.agents
                    .filter(
                      (agent) => agent.enabled && agent.showInRoster !== false
                    )
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setEditor({ type: "agent", item: null })}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-cyan-300 px-3 text-xs font-semibold text-zinc-950 transition hover:bg-cyan-200"
              >
                <Plus size={14} weight="bold" /> 新建 Agent
              </button>
            </>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConfigSyncPanel onResolved={refresh} />
        {!showingSkills && !showingQuickTasks && (
          <section className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-theme-text-secondary">
                Agent showcase · {data.agents.length}
              </p>
            </div>
            {loading ? (
              <div className="h-32 animate-pulse rounded-2xl bg-white/5 light:bg-slate-100" />
            ) : data.agents.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {data.agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setEditor({ type: "agent", item: agent })}
                    className="group relative flex min-h-[126px] items-start gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-cyan-300/[0.035] light:border-slate-200 light:bg-white light:hover:border-cyan-400/40"
                  >
                    <AgentAvatar agent={agent} size={50} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate pr-6 text-sm font-semibold">
                        {agent.name}
                      </span>
                      <span className="mt-1.5 flex min-h-4 flex-wrap items-center gap-1.5">
                        {!agent.enabled && (
                          <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-400 light:bg-slate-100 light:text-slate-500">
                            {t("predefined_agents.disabled_badge")}
                          </span>
                        )}
                        {agent.enabled && agent.showInRoster === false && (
                          <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300 light:bg-slate-100 light:text-slate-600">
                            {t("predefined_agents.hidden_badge")}
                          </span>
                        )}
                        {agent.id === data.defaultAgentId && (
                          <span className="rounded-full bg-cyan-300/10 px-1.5 py-0.5 text-[9px] text-cyan-300 light:bg-cyan-50 light:text-cyan-700">
                            Global default
                          </span>
                        )}
                        {agent.isBuiltinDefault && (
                          <span className="rounded-full bg-violet-300/10 px-1.5 py-0.5 text-[9px] text-violet-300 light:bg-violet-50 light:text-violet-700">
                            System
                          </span>
                        )}
                        <span className="rounded-full bg-emerald-300/10 px-1.5 py-0.5 text-[9px] text-emerald-300 light:bg-emerald-50 light:text-emerald-700">
                          {runtimeLabels[agent.runtimeKey] || agent.runtimeKey}
                        </span>
                      </span>
                      <span className="mt-2 block line-clamp-2 text-xs leading-5 text-theme-text-secondary">
                        {agent.description || "暂无描述"}
                      </span>
                      <span className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-theme-text-secondary">
                        <span className="rounded-md bg-white/5 px-1.5 py-1 light:bg-slate-100">
                          {agent.tools === null
                            ? "全部工具"
                            : `${agent.tools.length} 个工具`}
                        </span>
                        <span className="rounded-md bg-white/5 px-1.5 py-1 light:bg-slate-100">
                          {agent.skillIds.length} 个 Skill
                        </span>
                      </span>
                    </span>
                    <NotePencil
                      size={15}
                      className="absolute right-3 top-3 text-zinc-600 transition group-hover:text-cyan-300 light:text-slate-300"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                onClick={() => setEditor({ type: "agent", item: null })}
              />
            )}
            {!loading && (
              <ModelCapabilityRegistry
                items={data.modelCapabilities || []}
                onSaved={refresh}
              />
            )}
          </section>
        )}

        {showingSkills && (
          <section className="p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-theme-text-secondary">
                  Skill library
                </p>
                <p className="mt-1 text-[11px] text-theme-text-secondary">
                  Agent Skills 标准包、脚本、参考资料与资源
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl border border-white/10 p-1 light:border-slate-200">
                  {(
                    [
                      ["global", "Global", Globe],
                      ["workspace", "Workspace", FolderOpen],
                    ] as const
                  ).map(([scope, label, Icon]) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setSkillScope(scope)}
                      className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs ${
                        skillScope === scope
                          ? "bg-amber-300 text-zinc-950"
                          : "text-theme-text-secondary hover:text-theme-text-primary"
                      }`}
                    >
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
                {skillScope === "workspace" && (
                  <select
                    value={workspaceSlug}
                    onChange={(event) => setWorkspaceSlug(event.target.value)}
                    className={`${inputClass} h-10 min-w-44 py-0 text-xs`}
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.slug}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {visibleSkills.map((skill) => (
                <button
                  key={`${skillScope}:${skill.id || skill.name}`}
                  type="button"
                  onClick={() =>
                    setEditor({ type: "skill", item: skill, scope: skillScope })
                  }
                  className="group flex w-full items-start gap-3 rounded-xl border border-white/[0.07] p-3 text-left transition hover:border-amber-300/30 hover:bg-amber-300/[0.03] light:border-slate-200"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-300/10 text-amber-300 light:bg-amber-50 light:text-amber-700">
                    <Sparkle size={14} weight="fill" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {skill.name}
                    </span>
                    {!skill.valid && (
                      <span className="mt-1 block text-[10px] text-red-400">
                        {skill.errors?.[0] || "Invalid skill"}
                      </span>
                    )}
                    <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-theme-text-secondary">
                      {skill.description || skill.instructions}
                    </span>
                  </span>
                  <NotePencil
                    size={13}
                    className="mt-1 text-zinc-600 group-hover:text-amber-300 light:text-slate-300"
                  />
                </button>
              ))}
              {!loading && !visibleSkills.length && (
                <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-theme-text-secondary light:border-slate-300">
                  还没有自定义 Skill
                </p>
              )}
            </div>
          </section>
        )}

        {showingQuickTasks && (
          <section className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {(data.quickTasks || []).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => setEditor({ type: "quick-task", item: task })}
                className="rounded-xl border border-white/10 p-3 text-left hover:border-cyan-300/60 light:border-slate-200"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium">
                    {task.title}
                    {task.archived ? ` · ${t("quick_tasks.archived")}` : ""}
                  </span>
                  <NotePencil size={14} />
                </div>
                <p className="mt-1 text-xs leading-4 text-theme-text-secondary">
                  {task.description || task.key}
                </p>
              </button>
            ))}
            {!loading && !(data.quickTasks || []).length && (
              <p className="text-sm text-theme-text-secondary">
                {t("quick_tasks.empty")}
              </p>
            )}
          </section>
        )}
      </div>

      {editor?.type === "agent" && (
        <AgentEditor
          agent={editor.item}
          skills={data.skills}
          quickTasks={data.quickTasks}
          tools={data.tools}
          runtimes={data.runtimes}
          defaultAgentId={data.defaultAgentId}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}
      {editor?.type === "quick-task" && (
        <QuickTaskEditor
          task={editor.item}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}
      {editor?.type === "skill" && (
        <SkillEditor
          skill={editor.item}
          scope={editor.scope}
          workspaceSlug={workspaceSlug}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
            if (workspaceSlug) {
              const result =
                await PredefinedAgent.workspaceSkills(workspaceSlug);
              setWorkspaceSkills(result.skills || []);
            }
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[220px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 text-theme-text-secondary transition hover:border-cyan-300/30 hover:text-theme-text-primary light:border-slate-300"
    >
      <Robot size={34} weight="duotone" />
      <span className="mt-3 text-sm font-medium">创建第一个预定义 Agent</span>
      <span className="mt-1 text-xs">它会显示在聊天首页供所有用户选择</span>
    </button>
  );
}
