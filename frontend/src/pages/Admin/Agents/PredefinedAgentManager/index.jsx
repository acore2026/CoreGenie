import { useEffect, useMemo, useState } from "react";
import {
  ChatCircleText,
  Check,
  CheckCircle,
  Code,
  FileText,
  FolderOpen,
  Globe,
  NotePencil,
  Plus,
  Robot,
  Sparkle,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import PredefinedAgent from "@/models/predefinedAgent";
import AgentAvatar from "@/components/PredefinedAgents/AgentAvatar";
import showToast from "@/utils/toast";
import System from "@/models/system";
import useGetProviderModels from "@/hooks/useGetProvidersModels";
import Workspace from "@/models/workspace";

export default function PredefinedAgentManager({ view = "agents" }) {
  const [data, setData] = useState({
    agents: [],
    skills: [],
    tools: [],
    runtimes: [],
    modelCapabilities: [],
    defaultAgentId: null,
  });
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [skillScope, setSkillScope] = useState("global");
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [workspaceSkills, setWorkspaceSkills] = useState([]);
  const showingSkills = view === "skills";

  async function refresh() {
    const [next, availableWorkspaces] = await Promise.all([
      PredefinedAgent.adminList(),
      showingSkills ? Workspace.all() : Promise.resolve([]),
    ]);
    if (next.error) showToast(next.error, "error");
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
    refresh();
  }, []);

  useEffect(() => {
    if (!showingSkills || !workspaceSlug) {
      setWorkspaceSkills([]);
      return;
    }
    PredefinedAgent.workspaceSkills(workspaceSlug).then((result) => {
      if (result.error) showToast(result.error, "error");
      setWorkspaceSkills(result.skills || []);
    });
  }, [showingSkills, workspaceSlug]);

  const visibleSkills =
    skillScope === "workspace" ? workspaceSkills : data.skills;

  async function setDefaultAgent(event) {
    const agentId = Number(event.target.value);
    const result = await PredefinedAgent.setDefault(agentId);
    if (!result.success)
      return showToast(result.error || "设置默认 Agent 失败", "error");
    setData((current) => ({ ...current, defaultAgentId: agentId }));
    showToast("全局默认 Agent 已更新", "success");
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-theme-bg-secondary text-theme-text-primary">
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4 light:border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            {showingSkills ? (
              <Sparkle size={22} weight="duotone" className="text-amber-300" />
            ) : (
              <Robot size={22} weight="duotone" className="text-cyan-300" />
            )}
            <h1 className="text-lg font-semibold">
              {showingSkills ? "Skills" : "Predefined Agents"}
            </h1>
          </div>
          <p className="mt-1 text-xs text-theme-text-secondary">
            {showingSkills
              ? "创建可被多个 Agent 复用的专业知识与行为指令。"
              : "为不同任务配置独立的身份、Skill、工具权限和开场白。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          ) : (
            <>
              <label className="flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs text-theme-text-secondary light:border-slate-200">
                <span className="whitespace-nowrap">全局默认</span>
                <select
                  aria-label="Global default Agent"
                  value={data.defaultAgentId || ""}
                  onChange={setDefaultAgent}
                  disabled={
                    loading || !data.agents.some((agent) => agent.enabled)
                  }
                  className="max-w-40 bg-transparent font-medium text-theme-text-primary outline-none"
                >
                  {!data.defaultAgentId && (
                    <option value="" disabled>
                      未设置
                    </option>
                  )}
                  {data.agents
                    .filter((agent) => agent.enabled)
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
        {!showingSkills && (
          <section className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-theme-text-secondary">
                Agent showcase · {data.agents.length}
              </p>
            </div>
            {loading ? (
              <div className="h-32 animate-pulse rounded-2xl bg-white/5 light:bg-slate-100" />
            ) : data.agents.length ? (
              <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                {data.agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setEditor({ type: "agent", item: agent })}
                    className="group relative flex min-h-[126px] items-start gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-cyan-300/[0.035] light:border-slate-200 light:bg-white light:hover:border-cyan-400/40"
                  >
                    <AgentAvatar agent={agent} size={50} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">
                          {agent.name}
                        </span>
                        {!agent.enabled && (
                          <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-400 light:bg-slate-100 light:text-slate-500">
                            Disabled
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
                          Governed
                        </span>
                      </span>
                      <span className="mt-1.5 block line-clamp-2 text-xs leading-5 text-theme-text-secondary">
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
                  {[
                    ["global", "Global", Globe],
                    ["workspace", "Workspace", FolderOpen],
                  ].map(([scope, label, Icon]) => (
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
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
      </div>

      {editor?.type === "agent" && (
        <AgentEditor
          agent={editor.item}
          skills={data.skills}
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

function EmptyState({ onClick }) {
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

function ModelCapabilityRegistry({ items, onSaved }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    provider: "generic-openai",
    model: "",
    vision: false,
    toolCalling: true,
    structuredOutput: true,
    reasoningControls: false,
  });
  const flags = [
    ["vision", "Vision"],
    ["toolCalling", "Tools"],
    ["structuredOutput", "Structured output"],
    ["reasoningControls", "Reasoning controls"],
  ];

  async function save(payload) {
    const result = await PredefinedAgent.saveModelCapability(payload);
    if (!result.success)
      return showToast(result.error || "保存模型能力失败", "error");
    setAdding(false);
    setDraft((current) => ({ ...current, model: "" }));
    await onSaved();
  }

  return (
    <div className="mt-7 border-t border-white/[0.07] pt-5 light:border-slate-200">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-theme-text-secondary">
            Model capability registry
          </p>
          <p className="m-0 mt-1 text-[11px] text-theme-text-secondary">
            自定义模型必须明确声明能力，运行时不会猜测。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-semibold text-theme-text-primary hover:bg-white/[0.04] light:border-slate-200 light:hover:bg-slate-100"
        >
          <Plus size={13} /> Add model
        </button>
      </div>
      {adding && (
        <div className="mb-3 grid gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.025] p-3 md:grid-cols-[150px_minmax(180px,1fr)_auto]">
          <input
            value={draft.provider}
            onChange={(event) =>
              setDraft({ ...draft, provider: event.target.value })
            }
            className={inputClass}
            placeholder="Provider"
          />
          <input
            value={draft.model}
            onChange={(event) =>
              setDraft({ ...draft, model: event.target.value })
            }
            className={inputClass}
            placeholder="Exact model ID"
          />
          <button
            type="button"
            disabled={!draft.provider.trim() || !draft.model.trim()}
            onClick={() => save(draft)}
            className={primaryButtonClass}
          >
            Save
          </button>
          <div className="flex flex-wrap gap-3 md:col-span-3">
            {flags.map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-1.5 text-[11px] text-theme-text-secondary"
              >
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: event.target.checked })
                  }
                  className="accent-cyan-300"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.07] light:divide-slate-200 light:border-slate-200">
        {items.length ? (
          items.map((item) => (
            <div
              key={`${item.provider}:${item.model}`}
              className="grid min-h-12 items-center gap-2 px-3 py-2 md:grid-cols-[minmax(160px,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="m-0 truncate text-xs font-semibold text-theme-text-primary">
                  {item.model}
                </p>
                <p className="m-0 mt-0.5 font-mono text-[10px] text-theme-text-secondary">
                  {item.provider} · {item.source}
                </p>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {flags.map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-1 text-[10px] text-theme-text-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(item[key])}
                      onChange={(event) =>
                        save({ ...item, [key]: event.target.checked })
                      }
                      className="accent-cyan-300"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="m-0 p-3 text-xs text-theme-text-secondary">
            No explicit capabilities have been registered yet.
          </p>
        )}
      </div>
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        className={`flex max-h-[92vh] w-full ${wide ? "max-w-6xl" : "max-w-3xl"} flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl light:border-slate-200 light:bg-white`}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-white/10 px-5 py-4 light:border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-white light:text-slate-900">
              {title}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 light:text-slate-500">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white light:hover:bg-slate-100 light:hover:text-slate-900"
          >
            <X size={17} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function AgentEditor({
  agent,
  skills,
  tools,
  runtimes,
  defaultAgentId,
  onClose,
  onSaved,
}) {
  const isCurrentDefault = agent?.id === defaultAgentId;
  const [form, setForm] = useState({
    name: agent?.name || "",
    description: agent?.description || "",
    welcomeMessage: agent?.welcomeMessage || "",
    examplePrompts: (agent?.examplePrompts || []).map((prompt) => {
      if (typeof prompt === "string") return { label: prompt, prompt };
      return {
        label: String(prompt?.label || prompt?.prompt || ""),
        prompt: String(prompt?.prompt || ""),
      };
    }),
    systemPrompt: agent?.systemPrompt || "",
    enabled: agent?.enabled ?? true,
    allTools: agent?.tools === null || !agent,
    tools: agent?.tools || [],
    skillIds: agent?.skillIds || [],
    runtimeKey: "governed-agent",
    runtimeConfig: agent?.runtimeConfig || {},
    makeDefault: isCurrentDefault,
  });
  const [icon, setIcon] = useState(null);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState(null);
  const [fallbackModel, setFallbackModel] = useState("");
  const {
    defaultModels,
    customModels,
    loading: modelsLoading,
  } = useGetProviderModels(provider);
  const preview = useMemo(
    () => (icon ? URL.createObjectURL(icon) : null),
    [icon]
  );
  const selectedRuntime = useMemo(
    () =>
      runtimes.find((runtime) => runtime.key === form.runtimeKey) ||
      runtimes[0],
    [runtimes, form.runtimeKey]
  );
  const models = useMemo(() => {
    const values = [
      ...defaultModels.map((model) =>
        typeof model === "string" ? { id: model, name: model } : model
      ),
      ...(Array.isArray(customModels)
        ? customModels
        : Object.values(customModels || {}).flat()),
    ];
    const unique = new Map();
    for (const model of values) {
      const id = typeof model === "string" ? model : model?.id;
      if (id && !unique.has(id))
        unique.set(id, {
          id,
          name: typeof model === "string" ? model : model.name || id,
        });
    }
    for (const [key, value] of Object.entries(form.runtimeConfig || {})) {
      if (!key.endsWith("Model")) continue;
      if (value && !unique.has(value))
        unique.set(value, { id: value, name: value });
    }
    return [...unique.values()];
  }, [customModels, defaultModels, form.runtimeConfig]);

  useEffect(() => {
    System.keys().then((settings) => {
      setProvider(settings?.LLMProvider || null);
      setFallbackModel(settings?.LLMModel || "");
    });
  }, []);

  function toggleList(key, value) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  }

  function updateExamplePrompt(index, field, value) {
    setForm((current) => ({
      ...current,
      examplePrompts: current.examplePrompts.map((prompt, promptIndex) =>
        promptIndex === index ? { ...prompt, [field]: value } : prompt
      ),
    }));
  }

  function addExamplePrompt() {
    setForm((current) => ({
      ...current,
      examplePrompts:
        current.examplePrompts.length >= 6
          ? current.examplePrompts
          : [...current.examplePrompts, { label: "", prompt: "" }],
    }));
  }

  function removeExamplePrompt(index) {
    setForm((current) => ({
      ...current,
      examplePrompts: current.examplePrompts.filter(
        (_, promptIndex) => promptIndex !== index
      ),
    }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      description: form.description,
      welcomeMessage: form.welcomeMessage,
      examplePrompts: form.examplePrompts.filter((prompt) =>
        prompt.prompt.trim()
      ),
      systemPrompt: form.systemPrompt,
      enabled: form.enabled,
      tools: form.allTools ? null : form.tools,
      skillIds: form.skillIds,
      runtimeKey: form.runtimeKey,
      runtimeConfig: form.runtimeConfig,
    };
    const result = agent
      ? await PredefinedAgent.update(agent.id, payload)
      : await PredefinedAgent.create(payload);
    if (!result.success) {
      showToast(result.error || "保存失败", "error");
      setSaving(false);
      return;
    }
    if (icon) {
      const iconResult = await PredefinedAgent.uploadIcon(
        result.agent.id,
        icon
      );
      if (!iconResult.success)
        showToast(iconResult.error || "图标上传失败", "error");
    }
    if (
      form.enabled &&
      form.makeDefault &&
      result.agent.id !== defaultAgentId
    ) {
      const defaultResult = await PredefinedAgent.setDefault(result.agent.id);
      if (!defaultResult.success) {
        showToast(
          defaultResult.error || "Agent 已保存，但设置全局默认失败",
          "error"
        );
        setSaving(false);
        return;
      }
    }
    showToast(agent ? "Agent 已更新" : "Agent 已创建", "success");
    await onSaved();
  }

  async function remove() {
    if (!agent || !window.confirm(`删除 Agent“${agent.name}”？`)) return;
    const result = await PredefinedAgent.delete(agent.id);
    if (!result.success) return showToast(result.error || "删除失败", "error");
    showToast("Agent 已删除", "success");
    await onSaved();
  }

  return (
    <ModalShell
      title={agent ? `编辑 ${agent.name}` : "新建 Agent"}
      subtitle="配置展示信息、第一句话、系统提示词与可执行能力。"
      onClose={onClose}
    >
      <form onSubmit={save} className="min-h-0 overflow-y-auto p-5">
        <div className="grid gap-4 md:grid-cols-[120px_1fr]">
          <label className="group flex h-[120px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/15 bg-white/[0.025] text-xs text-zinc-500 hover:border-cyan-300/40 light:border-slate-300 light:bg-slate-50">
            {preview || agent?.iconUrl ? (
              <img
                src={preview || agent.iconUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <>
                <UploadSimple size={22} />
                <span className="mt-2">上传图标</span>
              </>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => setIcon(event.target.files?.[0] || null)}
            />
          </label>
          <div className="space-y-3">
            <Field label="名称">
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                className={inputClass}
                placeholder="例如：研究分析师"
              />
            </Field>
            <Field label="描述">
              <input
                maxLength={500}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                className={inputClass}
                placeholder="说明这个 Agent 擅长什么"
              />
            </Field>
            <label className="flex items-center gap-2 text-xs text-zinc-400 light:text-slate-600">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={saving}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setForm({
                    ...form,
                    enabled,
                    makeDefault: enabled ? form.makeDefault : false,
                  });
                }}
                className="accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {agent?.isBuiltinDefault
                ? "在 Agent 列表中启用内置通用助手"
                : isCurrentDefault
                  ? "停用后，不再作为全局默认 Agent"
                  : "在 Agent 展示区启用"}
            </label>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <Field
            label="Governed Agent runtime"
            hint="自动选择直接回答或依赖任务图；失败任务不会清除成功结果"
          >
            <div className="flex items-start gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.035] px-3 py-2.5 text-[11px] leading-4 text-theme-text-secondary">
              <CheckCircle
                size={15}
                weight="fill"
                className="mt-px shrink-0 text-emerald-300 light:text-emerald-700"
              />
              <span>{selectedRuntime?.description}</span>
            </div>
          </Field>

          {selectedRuntime?.modelRoles?.length > 0 && (
            <Field
              label="Runtime role models"
              hint={`留空时使用聊天框选择的模型${fallbackModel ? `（当前 ${fallbackModel}）` : ""}`}
            >
              <div className="grid gap-2 rounded-2xl border border-white/[0.08] bg-black/10 p-3 sm:grid-cols-2 xl:grid-cols-4 light:border-slate-200 light:bg-slate-50">
                {selectedRuntime.modelRoles.map((role) => {
                  const key = `${role}Model`;
                  return (
                    <label key={role} className="min-w-0">
                      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 light:text-slate-500">
                        {role}
                      </span>
                      <select
                        value={form.runtimeConfig?.[key] || ""}
                        disabled={modelsLoading}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            runtimeConfig: {
                              ...form.runtimeConfig,
                              [key]: event.target.value || null,
                            },
                          })
                        }
                        className={`${inputClass} truncate`}
                        aria-label={`${role} model`}
                      >
                        <option value="">Inherit chat model</option>
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-zinc-600 light:text-slate-500">
                模型名称会在每个工作区中解析；不可用时自动回退到该次对话的模型。
              </p>
            </Field>
          )}

          <Field label="自定义第一句话" hint="替换“今天我能帮您什么？”">
            <input
              maxLength={300}
              value={form.welcomeMessage}
              onChange={(event) =>
                setForm({ ...form, welcomeMessage: event.target.value })
              }
              className={inputClass}
              placeholder="今天想从哪项工作开始？"
            />
          </Field>
          <Field
            label="示例输入"
            hint="显示在输入框上方；点击后填入输入框，最多 6 条"
          >
            <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-black/10 p-3 light:border-slate-200 light:bg-slate-50">
              {form.examplePrompts.map((prompt, index) => (
                <div
                  key={index}
                  className="grid items-start gap-2 md:grid-cols-[32px_minmax(0,1fr)_minmax(0,1.5fr)_32px]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300 light:bg-cyan-50 light:text-cyan-700">
                    <ChatCircleText size={15} weight="duotone" />
                  </span>
                  <input
                    maxLength={120}
                    value={prompt.label}
                    onChange={(event) =>
                      updateExamplePrompt(index, "label", event.target.value)
                    }
                    className={`${inputClass} min-w-0 flex-1`}
                    placeholder="页面显示的短标题"
                    aria-label={`示例输入 ${index + 1} 的短标题`}
                  />
                  <textarea
                    maxLength={1000}
                    rows={2}
                    value={prompt.prompt}
                    onChange={(event) =>
                      updateExamplePrompt(index, "prompt", event.target.value)
                    }
                    className={`${inputClass} min-w-0 flex-1 resize-y`}
                    placeholder="点击后填入输入框的完整任务"
                    aria-label={`示例输入 ${index + 1} 的完整任务`}
                  />
                  <button
                    type="button"
                    onClick={() => removeExamplePrompt(index)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-red-400/10 hover:text-red-400 light:text-slate-400"
                    aria-label={`删除示例输入 ${index + 1}`}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              {form.examplePrompts.length < 6 && (
                <button
                  type="button"
                  onClick={addExamplePrompt}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/10 text-xs font-medium text-zinc-500 transition hover:border-cyan-300/35 hover:text-cyan-300 light:border-slate-300 light:text-slate-500"
                >
                  <Plus size={14} weight="bold" /> 添加示例输入
                </button>
              )}
            </div>
          </Field>
          <Field label="System Prompt">
            <textarea
              required
              value={form.systemPrompt}
              onChange={(event) =>
                setForm({ ...form, systemPrompt: event.target.value })
              }
              className={`${inputClass} min-h-36 resize-y leading-5`}
              placeholder="定义角色、工作方式、输出要求和边界……"
            />
          </Field>

          {!agent?.isBuiltinDefault && (
            <label
              className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${
                form.makeDefault
                  ? "border-cyan-300/40 bg-cyan-300/[0.07]"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20 light:border-slate-200 light:bg-slate-50 light:hover:border-slate-300"
              } ${isCurrentDefault ? "cursor-default" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                checked={form.makeDefault}
                disabled={isCurrentDefault}
                onChange={(event) =>
                  setForm({
                    ...form,
                    makeDefault: event.target.checked,
                    enabled: event.target.checked ? true : form.enabled,
                  })
                }
                className="mt-0.5 accent-cyan-300 disabled:cursor-not-allowed"
              />
              <span>
                <span className="block text-xs font-semibold text-zinc-200 light:text-slate-800">
                  {isCurrentDefault
                    ? "当前为所有工作区的默认 Agent"
                    : "设为所有工作区的默认 Agent"}
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-zinc-500 light:text-slate-500">
                  未明确选择其他 Agent 的对话都会使用此 Agent。内置 Default
                  Agent 仍会保留，但不再作为全局默认使用。
                </span>
              </span>
            </label>
          )}

          <Field
            label="Skills"
            hint="只注入目录，Agent 使用前会按需激活完整指令"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {skills.map((skill) => (
                <CheckCard
                  key={skill.id}
                  checked={form.skillIds.includes(skill.id)}
                  title={skill.name}
                  description={skill.description}
                  onClick={() => toggleList("skillIds", skill.id)}
                />
              ))}
              {!skills.length && (
                <p className="text-xs text-zinc-500">
                  请先在 Skill library 创建 Skill。
                </p>
              )}
            </div>
          </Field>

          <Field
            label="Allowed tools"
            hint="默认允许当前已启用的全部 Agent Tools"
          >
            <label className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 p-3 text-xs text-zinc-300 light:border-slate-200 light:text-slate-700">
              <input
                type="checkbox"
                checked={form.allTools}
                onChange={(event) =>
                  setForm({ ...form, allTools: event.target.checked })
                }
                className="accent-cyan-300"
              />
              始终允许全部已启用工具
            </label>
            {!form.allTools && (
              <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {tools.map((tool) => (
                  <CheckCard
                    key={tool.id}
                    checked={form.tools.includes(tool.id)}
                    title={tool.name}
                    description={tool.id}
                    onClick={() => toggleList("tools", tool.id)}
                  />
                ))}
              </div>
            )}
          </Field>
        </div>

        <footer className="flex items-center justify-between border-t border-white/10 px-5 py-4 light:border-slate-200">
          <div>
            {agent && !agent.isBuiltinDefault && !isCurrentDefault && (
              <button
                type="button"
                onClick={remove}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300"
              >
                <Trash size={14} /> 删除 Agent
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={secondaryButtonClass}
            >
              取消
            </button>
            <button
              disabled={saving}
              type="submit"
              className={primaryButtonClass}
            >
              {saving ? "保存中…" : "保存 Agent"}
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  );
}

function SkillEditor({ skill, scope, workspaceSlug, onClose, onSaved }) {
  const newSkillMd = `---\nname: new-skill\ndescription: Describe what this skill does and when the Agent should use it.\n---\n\n# New skill\n\nWrite the skill instructions here.\n`;
  const [skillMd, setSkillMd] = useState(skill?.skillMd || newSkillMd);
  const [files, setFiles] = useState(skill?.files || []);
  const [deletedPaths, setDeletedPaths] = useState([]);
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  const [loading, setLoading] = useState(Boolean(skill));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!skill) return;
    const loader =
      scope === "workspace"
        ? PredefinedAgent.getWorkspaceSkill(workspaceSlug, skill.name)
        : PredefinedAgent.getSkill(skill.id);
    loader.then((result) => {
      if (!result.skill) showToast(result.error || "无法加载 Skill", "error");
      else {
        setSkillMd(result.skill.skillMd || newSkillMd);
        setFiles(result.skill.files || []);
      }
      setLoading(false);
    });
  }, [skill?.id, skill?.name, scope, workspaceSlug]);

  const selectedFile = files.find((file) => file.path === selectedPath);
  const currentName =
    skillMd.match(/^---[\s\S]*?\nname:\s*["']?([^\n"']+)/)?.[1]?.trim() ||
    skill?.name ||
    "new-skill";

  function updateSelected(content) {
    if (selectedPath === "SKILL.md") return setSkillMd(content);
    setFiles((current) =>
      current.map((file) =>
        file.path === selectedPath
          ? { ...file, content, encoding: "utf8", text: true }
          : file
      )
    );
  }

  function addTextFile(folder, extension) {
    const proposed = `${folder}/new-${folder === "scripts" ? "script" : "resource"}.${extension}`;
    const value = window.prompt("Package-relative file path", proposed)?.trim();
    if (!value || value === "SKILL.md") return;
    if (files.some((file) => file.path === value))
      return showToast("文件已经存在", "error");
    setFiles((current) => [
      ...current,
      { path: value, content: "", encoding: "utf8", text: true, size: 0 },
    ]);
    setDeletedPaths((current) => current.filter((path) => path !== value));
    setSelectedPath(value);
  }

  function deleteSelected() {
    if (selectedPath === "SKILL.md") return;
    setFiles((current) => current.filter((file) => file.path !== selectedPath));
    setDeletedPaths((current) => [...new Set([...current, selectedPath])]);
    setSelectedPath("SKILL.md");
  }

  async function addAsset(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const target = window
      .prompt("Package-relative asset path", `assets/${file.name}`)
      ?.trim();
    if (!target) return;
    const text =
      file.type.startsWith("text/") ||
      /\.(md|txt|json|ya?ml|csv|xml|html|css|js|ts|py|sh)$/i.test(file.name);
    const content = text
      ? await file.text()
      : await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
    setFiles((current) => [
      ...current.filter((item) => item.path !== target),
      {
        path: target,
        content,
        encoding: text ? "utf8" : "base64",
        text,
        size: file.size,
      },
    ]);
    setDeletedPaths((current) => current.filter((path) => path !== target));
    setSelectedPath(target);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    const payload = {
      skillMd,
      files: files
        .filter((file) => file.content != null)
        .map(({ path, content, encoding }) => ({ path, content, encoding })),
      deletedPaths,
      ...(scope === "workspace" && skill ? { previousName: skill.name } : {}),
    };
    const result =
      scope === "workspace"
        ? await PredefinedAgent.saveWorkspaceSkill(workspaceSlug, payload)
        : skill
          ? await PredefinedAgent.updateSkill(skill.id, payload)
          : await PredefinedAgent.createSkill(payload);
    if (!result.success) {
      showToast(result.error || "保存失败", "error");
      setSaving(false);
      return;
    }
    showToast(skill ? "Skill 已更新" : "Skill 已创建", "success");
    await onSaved();
  }

  async function remove() {
    if (!skill || !window.confirm(`删除 Skill“${skill.name}”？`)) return;
    const result =
      scope === "workspace"
        ? await PredefinedAgent.deleteWorkspaceSkill(workspaceSlug, skill.name)
        : await PredefinedAgent.deleteSkill(skill.id);
    if (!result.success) return showToast(result.error || "删除失败", "error");
    showToast("Skill 已删除", "success");
    await onSaved();
  }

  return (
    <ModalShell
      title={skill ? `编辑 ${skill.name}` : "新建 Skill"}
      subtitle={`${scope === "workspace" ? "Workspace · live" : "Global · versioned"} · Agent Skills specification`}
      onClose={onClose}
      wide
    >
      <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 md:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-white/10 p-3 light:border-slate-200">
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => addTextFile("scripts", "py")}
                className={miniButtonClass}
              >
                <Code size={12} /> Python
              </button>
              <button
                type="button"
                onClick={() => addTextFile("scripts", "sh")}
                className={miniButtonClass}
              >
                <Code size={12} /> Bash
              </button>
              <button
                type="button"
                onClick={() => addTextFile("references", "md")}
                className={miniButtonClass}
              >
                <FileText size={12} /> Reference
              </button>
              <label className={`${miniButtonClass} cursor-pointer`}>
                <UploadSimple size={12} /> Asset
                <input type="file" className="hidden" onChange={addAsset} />
              </label>
            </div>
            {[{ path: "SKILL.md", text: true }, ...files].map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${
                  selectedPath === file.path
                    ? "bg-amber-300/15 text-amber-200 light:text-amber-800"
                    : "text-theme-text-secondary hover:bg-white/5 light:hover:bg-slate-100"
                }`}
              >
                {file.path.startsWith("scripts/") ? (
                  <Code size={13} />
                ) : (
                  <FileText size={13} />
                )}
                <span className="min-w-0 flex-1 truncate font-mono">
                  {file.path}
                </span>
                {file.text === false && <span className="text-[9px]">BIN</span>}
              </button>
            ))}
          </aside>
          <section className="flex min-h-[440px] min-w-0 flex-col p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 truncate font-mono text-xs font-semibold text-theme-text-primary">
                  {selectedPath}
                </p>
                <p className="m-0 mt-1 text-[10px] text-theme-text-secondary">
                  {currentName} · changes become available on the next Agent
                  step
                </p>
              </div>
              {selectedPath !== "SKILL.md" && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  删除文件
                </button>
              )}
            </div>
            {loading ? (
              <div className="flex-1 animate-pulse rounded-xl bg-white/5 light:bg-slate-100" />
            ) : selectedPath === "SKILL.md" || selectedFile?.text !== false ? (
              <textarea
                required={selectedPath === "SKILL.md"}
                spellCheck={false}
                value={
                  selectedPath === "SKILL.md"
                    ? skillMd
                    : selectedFile?.content || ""
                }
                onChange={(event) => updateSelected(event.target.value)}
                className={`${inputClass} min-h-0 flex-1 resize-none whitespace-pre font-mono text-xs leading-5`}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-theme-text-secondary light:border-slate-300">
                Binary asset · {selectedFile?.size || 0} bytes
              </div>
            )}
            {!!skill?.warnings?.length && (
              <p className="mt-2 text-[10px] text-amber-300">
                {skill.warnings.join(" · ")}
              </p>
            )}
          </section>
        </div>
        <footer className="flex items-center justify-between border-t border-white/10 px-5 py-4 light:border-slate-200">
          <div>
            {skill && (
              <button
                type="button"
                onClick={remove}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300"
              >
                <Trash size={14} /> 删除 Skill
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={secondaryButtonClass}
            >
              取消
            </button>
            <button
              disabled={
                saving || loading || (scope === "workspace" && !workspaceSlug)
              }
              type="submit"
              className={primaryButtonClass}
            >
              {saving ? "保存中…" : "保存 Skill"}
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  );
}

function Field({ label, hint = null, children }) {
  return (
    <div className="block">
      <span className="mb-1.5 flex items-center gap-2 text-xs font-medium text-zinc-300 light:text-slate-700">
        {label}
        {hint && (
          <span className="font-normal text-zinc-600 light:text-slate-400">
            {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

function CheckCard({ checked, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 items-start gap-2.5 rounded-xl border p-2.5 text-left transition ${
        checked
          ? "border-cyan-300/35 bg-cyan-300/[0.07]"
          : "border-white/[0.08] hover:border-white/20 light:border-slate-200 light:hover:border-slate-300"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked
            ? "border-cyan-300 bg-cyan-300 text-zinc-950"
            : "border-zinc-600 light:border-slate-300"
        }`}
      >
        {checked && <Check size={10} weight="bold" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-zinc-200 light:text-slate-800">
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-[10px] text-zinc-600 light:text-slate-400">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-cyan-300/45 light:border-slate-200 light:bg-slate-50 light:text-slate-900 light:placeholder:text-slate-400";
const primaryButtonClass =
  "h-9 rounded-xl bg-cyan-300 px-4 text-xs font-semibold text-zinc-950 hover:bg-cyan-200 disabled:opacity-50";
const secondaryButtonClass =
  "h-9 rounded-xl border border-white/10 px-4 text-xs text-zinc-400 hover:bg-white/5 hover:text-white light:border-slate-200 light:text-slate-600 light:hover:bg-slate-100";
const miniButtonClass =
  "inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2 text-[10px] text-theme-text-secondary hover:border-amber-300/30 hover:text-amber-200 light:border-slate-200 light:hover:text-amber-700";
