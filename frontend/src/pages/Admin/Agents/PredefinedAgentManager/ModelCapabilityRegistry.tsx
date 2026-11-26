import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import PredefinedAgent from "@/models/predefinedAgent";
import showToast from "@/utils/toast";
import { inputClass, primaryButtonClass } from "./Controls";
import type { Capability, SaveResult } from "@/models/predefinedAgentTypes";

export default function ModelCapabilityRegistry({
  items,
  onSaved,
}: {
  items: Capability[];
  onSaved(): Promise<void>;
}) {
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
  ] as const;

  async function save(payload: Capability) {
    const result: SaveResult =
      await PredefinedAgent.saveModelCapability(payload);
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
