import { Plus, Question, X } from "@phosphor-icons/react";
import VariableInput from "../../VariableInput";

const INPUT_TYPES = ["text", "textarea", "url", "number", "date", "email"];

export default function RequestUserInputNode({
  config,
  onConfigChange,
  renderVariableSelect,
}) {
  const isChoice = config.kind === "choice";
  const options = config.options || ["Option 1", "Option 2"];

  const updateOption = (index, value) => {
    const next = [...options];
    next[index] = value;
    onConfigChange({ ...config, options: next });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.045] p-3.5">
        <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">
          <Question size={15} weight="duotone" /> Interactive checkpoint
        </div>
        <div className="grid grid-cols-2 gap-2">
          {["input", "choice"].map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onConfigChange({ ...config, kind })}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                config.kind === kind
                  ? "border-amber-300/40 bg-amber-300/10 text-amber-200 light:text-amber-800"
                  : "border-white/10 text-theme-text-secondary hover:border-white/20 light:border-slate-200"
              }`}
            >
              {kind === "input" ? "Free-form input" : "Choice list"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-theme-text-primary">
          Question
        </label>
        <VariableInput
          multiline
          rows={3}
          value={config.question || ""}
          onChange={(event) =>
            onConfigChange({ ...config, question: event.target.value })
          }
          placeholder="What information should the flow request?"
        />
      </div>

      {isChoice ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-theme-text-primary">
            Options
          </label>
          {options.map((option, index) => (
            <div key={index} className="flex gap-2">
              <VariableInput
                value={option}
                onChange={(event) => updateOption(index, event.target.value)}
                placeholder={`Option ${index + 1}`}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() =>
                    onConfigChange({
                      ...config,
                      options: options.filter((_, i) => i !== index),
                    })
                  }
                  className="rounded-lg bg-theme-settings-input-bg p-2.5 text-theme-text-secondary hover:text-red-400"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onConfigChange({
                ...config,
                options: [...options, `Option ${options.length + 1}`],
              })
            }
            className="flex items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-amber-200"
          >
            <Plus size={13} /> Add option
          </button>
          <div className="flex gap-4 pt-1 text-xs text-theme-text-secondary">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.allowOther !== false}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    allowOther: event.target.checked,
                  })
                }
                className="accent-amber-300"
              />
              Allow custom answer
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!config.multiSelect}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    multiSelect: event.target.checked,
                  })
                }
                className="accent-amber-300"
              />
              Multiple choices
            </label>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-theme-text-primary">
              Input type
            </label>
            <select
              value={config.inputType || "text"}
              onChange={(event) =>
                onConfigChange({ ...config, inputType: event.target.value })
              }
              className="w-full rounded-lg border-none bg-theme-settings-input-bg p-2.5 text-sm text-theme-text-primary outline-none"
            >
              {INPUT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-theme-text-primary">
              Placeholder
            </label>
            <VariableInput
              value={config.placeholder || ""}
              onChange={(event) =>
                onConfigChange({ ...config, placeholder: event.target.value })
              }
              placeholder="Optional hint"
            />
          </div>
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-theme-text-primary">
          Answer Variable
        </label>
        {renderVariableSelect(
          config.resultVariable,
          (value) => onConfigChange({ ...config, resultVariable: value }),
          "Store the user's answer"
        )}
      </div>
    </div>
  );
}
