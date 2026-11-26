import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChatCircleText,
  CheckCircle,
  Plus,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import PredefinedAgent from "@/models/predefinedAgent";
import showToast from "@/utils/toast";
import System from "@/models/system";
import useGetProviderModels from "@/hooks/useGetProvidersModels";
import FullscreenEditor from "@/components/FullscreenEditor";
import {
  ModalShell,
  Field,
  CheckCard,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./Controls";
import type {
  AdminData,
  Agent,
  ExamplePrompt,
  SaveResult,
} from "@/models/predefinedAgentTypes";
import type { EditorActions } from "./types";

export default function AgentEditor({
  agent,
  skills,
  quickTasks = [],
  tools,
  runtimes,
  defaultAgentId,
  onClose,
  onSaved,
}: EditorActions &
  Pick<
    AdminData,
    "skills" | "quickTasks" | "tools" | "runtimes" | "defaultAgentId"
  > & { agent: Agent | null }) {
  const { t } = useTranslation();
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
    showInRoster: agent?.showInRoster ?? true,
    allTools: agent?.tools === null || !agent,
    tools: agent?.tools || [],
    skillIds: agent?.skillIds || [],
    quickTaskIds: agent?.quickTaskIds || [],
    runtimeKey: agent?.runtimeKey || "governed-agent",
    runtimeConfig: agent?.runtimeConfig || {},
    makeDefault: isCurrentDefault,
  });
  const [icon, setIcon] = useState<File | null>(null);
  const [savedAgentId, setSavedAgentId] = useState(agent?.id);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
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
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
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
    const unique = new Map<string, { id: string; name: string }>();
    for (const model of values) {
      const id = typeof model === "string" ? model : model?.id;
      if (id && !unique.has(id))
        unique.set(id, {
          id,
          name: typeof model === "string" ? model : model.name || id,
        });
    }
    for (const [key, value] of Object.entries(form.runtimeConfig || {})) {
      if (!key.endsWith("Model") || typeof value !== "string") continue;
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

  function updateExamplePrompt(
    index: number,
    field: keyof ExamplePrompt,
    value: string
  ) {
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

  function removeExamplePrompt(index: number) {
    setForm((current) => ({
      ...current,
      examplePrompts: current.examplePrompts.filter(
        (_, promptIndex) => promptIndex !== index
      ),
    }));
  }

  async function save(event: React.FormEvent) {
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
      showInRoster: form.showInRoster,
      tools: form.allTools ? null : form.tools,
      skillIds: form.skillIds,
      quickTaskIds: form.quickTaskIds,
      runtimeKey: form.runtimeKey,
      runtimeConfig: form.runtimeConfig,
    };
    const result: SaveResult<{ agent: Agent }> = savedAgentId
      ? await PredefinedAgent.update(savedAgentId, payload)
      : await PredefinedAgent.create(payload);
    if (!result.success) {
      showToast(result.error || "保存失败", "error");
      setSaving(false);
      return;
    }
    setSavedAgentId(result.agent.id);
    if (icon) {
      const iconResult: SaveResult = await PredefinedAgent.uploadIcon(
        result.agent.id,
        icon
      );
      if (!iconResult.success) {
        showToast(iconResult.error || "图标上传失败", "error");
        setSaving(false);
        return;
      }
    }
    if (
      form.enabled &&
      form.showInRoster &&
      form.makeDefault &&
      result.agent.id !== defaultAgentId
    ) {
      const defaultResult: SaveResult = await PredefinedAgent.setDefault(
        result.agent.id
      );
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
                src={preview || agent?.iconUrl}
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
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-[72px] cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 transition hover:border-cyan-300/30 focus-within:ring-2 focus-within:ring-cyan-300/40 light:border-slate-200 light:bg-slate-50">
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
                  className="mt-0.5 accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span>
                  <span className="block text-xs font-semibold text-theme-text-primary">
                    {t("predefined_agents.enabled_label")}
                  </span>
                  <span className="mt-1 block text-[11px] leading-4 text-theme-text-secondary">
                    {t("predefined_agents.enabled_description")}
                  </span>
                </span>
              </label>
              <label className="flex min-h-[72px] cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 transition hover:border-cyan-300/30 focus-within:ring-2 focus-within:ring-cyan-300/40 light:border-slate-200 light:bg-slate-50">
                <input
                  type="checkbox"
                  checked={form.showInRoster}
                  disabled={saving}
                  onChange={(event) => {
                    const showInRoster = event.target.checked;
                    setForm({
                      ...form,
                      showInRoster,
                      makeDefault: showInRoster ? form.makeDefault : false,
                    });
                  }}
                  className="mt-0.5 accent-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span>
                  <span className="block text-xs font-semibold text-theme-text-primary">
                    {t("predefined_agents.roster_label")}
                  </span>
                  <span className="mt-1 block text-[11px] leading-4 text-theme-text-secondary">
                    {t("predefined_agents.roster_description")}
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <Field
            label="运行方式"
            hint="选择这个 Agent 处理任务时使用的执行方式"
          >
            <div className="grid gap-2 md:grid-cols-3">
              {runtimes.map((runtime) => {
                const selected = form.runtimeKey === runtime.key;
                return (
                  <label
                    key={runtime.key}
                    className={`relative flex min-h-28 flex-col rounded-xl border p-3 transition-colors duration-150 focus-within:ring-2 focus-within:ring-cyan-300/60 focus-within:ring-offset-2 focus-within:ring-offset-theme-bg-secondary ${
                      selected
                        ? "border-cyan-300/45 bg-cyan-300/[0.07]"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.035] light:border-slate-200 light:bg-slate-50 light:hover:border-slate-300 light:hover:bg-white"
                    } ${saving ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      type="radio"
                      name="agent-runtime"
                      value={runtime.key}
                      checked={selected}
                      disabled={saving}
                      onChange={() =>
                        setForm({
                          ...form,
                          runtimeKey: runtime.key,
                          runtimeConfig: {},
                        })
                      }
                      className="sr-only"
                    />
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-theme-text-primary">
                        {runtime.label}
                      </span>
                      {selected && (
                        <CheckCircle
                          size={16}
                          weight="fill"
                          className="shrink-0 text-cyan-300 light:text-cyan-700"
                        />
                      )}
                    </span>
                    <span className="mt-2 text-[11px] leading-4 text-theme-text-secondary">
                      {runtime.description}
                    </span>
                    {runtime.experimental && (
                      <span className="mt-auto pt-2 text-[10px] font-medium text-amber-300 light:text-amber-700">
                        实验功能
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </Field>

          {!!selectedRuntime?.modelRoles?.length && (
            <Field
              label="角色模型"
              hint={`留空时使用聊天框选择的模型${fallbackModel ? `（当前 ${fallbackModel}）` : ""}`}
            >
              <div className="grid gap-2 rounded-2xl border border-white/[0.08] bg-black/10 p-3 sm:grid-cols-2 xl:grid-cols-4 light:border-slate-200 light:bg-slate-50">
                {selectedRuntime.modelRoles.map((role) => {
                  const key = `${role}Model`;
                  const value = form.runtimeConfig[key];
                  return (
                    <label key={role} className="min-w-0">
                      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 light:text-slate-500">
                        {runtimeRoleLabels[role] || role}
                      </span>
                      <select
                        value={typeof value === "string" ? value : ""}
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
                        aria-label={`${runtimeRoleLabels[role] || role}模型`}
                      >
                        <option value="">使用对话模型</option>
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
            <FullscreenEditor title="System Prompt">
              <textarea
                required
                value={form.systemPrompt}
                onChange={(event) =>
                  setForm({ ...form, systemPrompt: event.target.value })
                }
                className={`${inputClass} min-h-36 resize-y leading-5`}
                placeholder="定义角色、工作方式、输出要求和边界……"
              />
            </FullscreenEditor>
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
                    showInRoster: event.target.checked
                      ? true
                      : form.showInRoster,
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
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      skillIds: toggleValue(current.skillIds, skill.id),
                    }))
                  }
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
            label={t("quick_tasks.title")}
            hint={t("quick_tasks.bind_hint")}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {quickTasks.map((task) => (
                <CheckCard
                  key={task.id}
                  checked={form.quickTaskIds.includes(task.id)}
                  title={task.title}
                  description={task.description || task.key}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      quickTaskIds: toggleValue(current.quickTaskIds, task.id),
                    }))
                  }
                />
              ))}
              {!quickTasks.length && (
                <p className="text-xs text-zinc-500">
                  {t("quick_tasks.empty")}
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
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        tools: toggleValue(current.tools, tool.id),
                      }))
                    }
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

const runtimeRoleLabels: Record<string, string> = {
  controller: "协调",
  planner: "规划",
  worker: "执行",
  reviewer: "审查",
  vision: "图像分析",
  synthesizer: "汇总",
};

function toggleValue<T>(items: T[], value: T): T[] {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}
