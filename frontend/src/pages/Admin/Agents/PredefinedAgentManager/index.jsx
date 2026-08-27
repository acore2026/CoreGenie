import { useEffect, useMemo, useState } from "react";
import {
  ChatCircleText,
  Check,
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

export default function PredefinedAgentManager({ view = "agents" }) {
  const [data, setData] = useState({
    agents: [],
    skills: [],
    tools: [],
    runtimes: [],
    defaultAgentId: null,
  });
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const showingSkills = view === "skills";

  async function refresh() {
    const next = await PredefinedAgent.adminList();
    if (next.error) showToast(next.error, "error");
    else setData(next);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

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
              onClick={() => setEditor({ type: "skill", item: null })}
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
                  disabled={loading || !data.agents.length}
                  className="max-w-40 bg-transparent font-medium text-theme-text-primary outline-none"
                >
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
                        {agent.runtimeKey === "evidence-research" && (
                          <span className="rounded-full bg-amber-300/10 px-1.5 py-0.5 text-[9px] text-amber-300 light:bg-amber-50 light:text-amber-700">
                            Research graph
                          </span>
                        )}
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
          </section>
        )}

        {showingSkills && (
          <section className="p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-theme-text-secondary">
                Skill library
              </p>
              <p className="mt-1 text-[11px] text-theme-text-secondary">
                可复用的行为与专业知识指令
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.skills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => setEditor({ type: "skill", item: skill })}
                  className="group flex w-full items-start gap-3 rounded-xl border border-white/[0.07] p-3 text-left transition hover:border-amber-300/30 hover:bg-amber-300/[0.03] light:border-slate-200"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-300/10 text-amber-300 light:bg-amber-50 light:text-amber-700">
                    <Sparkle size={14} weight="fill" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {skill.name}
                    </span>
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
              {!loading && !data.skills.length && (
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
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
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

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl light:border-slate-200 light:bg-white">
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
    examplePrompts: agent?.examplePrompts || [],
    systemPrompt: agent?.systemPrompt || "",
    enabled: agent?.enabled ?? true,
    allTools: agent?.tools === null || !agent,
    tools: agent?.tools || [],
    skillIds: agent?.skillIds || [],
    runtimeKey: agent?.runtimeKey || "default-react",
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
    for (const value of Object.values(form.runtimeConfig || {})) {
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

  function updateExamplePrompt(index, value) {
    setForm((current) => ({
      ...current,
      examplePrompts: current.examplePrompts.map((prompt, promptIndex) =>
        promptIndex === index ? value : prompt
      ),
    }));
  }

  function addExamplePrompt() {
    setForm((current) => ({
      ...current,
      examplePrompts:
        current.examplePrompts.length >= 6
          ? current.examplePrompts
          : [...current.examplePrompts, ""],
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
      examplePrompts: form.examplePrompts,
      systemPrompt: form.systemPrompt,
      enabled: form.makeDefault ? true : form.enabled,
      tools: form.allTools ? null : form.tools,
      skillIds: form.skillIds,
      runtimeKey: form.runtimeKey,
      runtimeConfig:
        form.runtimeKey === "evidence-research" ? form.runtimeConfig : {},
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
    if (form.makeDefault && result.agent.id !== defaultAgentId) {
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
                disabled={agent?.isBuiltinDefault || isCurrentDefault}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
                className="accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {agent?.isBuiltinDefault
                ? "内置 Default Agent 始终启用"
                : isCurrentDefault
                  ? "全局默认 Agent 必须保持启用"
                  : "在 Agent 展示区启用"}
            </label>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <Field
            label="Agent Runtime"
            hint="选择负责规划、工具循环、恢复与最终输出的执行图"
          >
            <div className="rounded-2xl border border-white/[0.08] bg-black/10 p-3 light:border-slate-200 light:bg-slate-50">
              <select
                value={form.runtimeKey}
                onChange={(event) =>
                  setForm({ ...form, runtimeKey: event.target.value })
                }
                className={inputClass}
                aria-label="Agent Runtime"
              >
                {runtimes.map((runtime) => (
                  <option key={runtime.key} value={runtime.key}>
                    {runtime.label}
                    {runtime.experimental ? " · Experimental" : ""}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex items-start gap-2 px-1">
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                    selectedRuntime?.experimental
                      ? "bg-amber-300"
                      : "bg-cyan-300"
                  }`}
                />
                <p className="text-[11px] leading-4 text-zinc-500 light:text-slate-500">
                  {selectedRuntime?.description}
                </p>
              </div>
            </div>
          </Field>

          {selectedRuntime?.modelRoles?.length > 0 && (
            <Field
              label="Runtime role models"
              hint={`留空时使用聊天框选择的模型${fallbackModel ? `（当前 ${fallbackModel}）` : ""}`}
            >
              <div className="grid gap-2 rounded-2xl border border-white/[0.08] bg-black/10 p-3 sm:grid-cols-3 light:border-slate-200 light:bg-slate-50">
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
                <div key={index} className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300 light:bg-cyan-50 light:text-cyan-700">
                    <ChatCircleText size={15} weight="duotone" />
                  </span>
                  <input
                    maxLength={240}
                    value={prompt}
                    onChange={(event) =>
                      updateExamplePrompt(index, event.target.value)
                    }
                    className={`${inputClass} min-w-0 flex-1`}
                    placeholder="例如：比较 Release 18 与 Release 19 的关键变化"
                    aria-label={`示例输入 ${index + 1}`}
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

          <Field label="Skills" hint="这些指令会追加到 Agent 的 System Prompt">
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

        <footer className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 light:border-slate-200">
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

function SkillEditor({ skill, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: skill?.name || "",
    description: skill?.description || "",
    instructions: skill?.instructions || "",
  });
  const [saving, setSaving] = useState(false);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    const result = skill
      ? await PredefinedAgent.updateSkill(skill.id, form)
      : await PredefinedAgent.createSkill(form);
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
    const result = await PredefinedAgent.deleteSkill(skill.id);
    if (!result.success) return showToast(result.error || "删除失败", "error");
    showToast("Skill 已删除", "success");
    await onSaved();
  }

  return (
    <ModalShell
      title={skill ? `编辑 ${skill.name}` : "新建 Skill"}
      subtitle="Skill 是可被多个 Agent 复用的专业指令块。"
      onClose={onClose}
    >
      <form onSubmit={save} className="min-h-0 overflow-y-auto p-5">
        <div className="space-y-4">
          <Field label="名称">
            <input
              required
              maxLength={80}
              className={inputClass}
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="例如：技术调研"
            />
          </Field>
          <Field label="描述">
            <input
              maxLength={500}
              className={inputClass}
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              placeholder="简要说明用途"
            />
          </Field>
          <Field label="Skill instructions">
            <textarea
              required
              className={`${inputClass} min-h-64 resize-y leading-5`}
              value={form.instructions}
              onChange={(event) =>
                setForm({ ...form, instructions: event.target.value })
              }
              placeholder="写明执行流程、质量标准、输出格式、注意事项……"
            />
          </Field>
        </div>
        <footer className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 light:border-slate-200">
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
              disabled={saving}
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
