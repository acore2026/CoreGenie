import { Gear } from "@phosphor-icons/react";
import System, { type SystemKeys } from "@/models/system";
import type { LLMProvider } from "@/components/LLMSelection/providers";
import SetupProvider from "@/components/WorkspaceChat/ChatContainer/PromptInput/LLMSelector/SetupProvider";
import { useModal } from "@/hooks/useModal";
import { useEffect, useState } from "react";

const NO_SETTINGS_NEEDED = ["default", "none"];
export default function WorkspaceProviderItem({
  llm,
  portalId,
  settings,
  checked,
  onClick,
}: {
  llm: LLMProvider;
  portalId: string;
  settings: SystemKeys;
  checked: boolean;
  onClick: () => void;
}) {
  const { isOpen, openModal, closeModal } = useModal();
  const { name, value, logo, description } = llm;
  const [currentSettings, setCurrentSettings] = useState(settings);

  useEffect(() => {
    async function getSettings() {
      if (isOpen) {
        const _settings = await System.keys();
        setCurrentSettings(_settings ?? {});
      }
    }
    getSettings();
  }, [isOpen]);

  function handleProviderSelection() {
    // Determine if provider needs additional setup because its minimum required keys are
    // not yet set in settings.
    if (!checked) {
      const requiresAdditionalSetup = (llm.requiredConfig || []).some(
        (key) => !currentSettings[key]
      );
      if (requiresAdditionalSetup) {
        openModal();
        return;
      }
      onClick();
    }
  }

  return (
    <>
      <div
        onClick={handleProviderSelection}
        className={`w-full p-2 rounded-md hover:cursor-pointer hover:bg-theme-bg-secondary ${
          checked ? "bg-theme-bg-secondary" : ""
        }`}
      >
        <input
          type="checkbox"
          value={value}
          className="peer hidden"
          checked={checked}
          readOnly={true}
          formNoValidate={true}
        />
        <div className="flex gap-x-4 items-center justify-between">
          <div className="flex gap-x-4 items-center">
            <img
              src={logo}
              alt={`${name} logo`}
              className="w-10 h-10 rounded-md"
            />
            <div className="flex flex-col">
              <div className="text-sm font-semibold text-white">{name}</div>
              <div className="mt-1 text-xs text-white/60">{description}</div>
            </div>
          </div>
          {checked && !NO_SETTINGS_NEEDED.includes(value) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                openModal();
              }}
              className="p-2 text-white/60 hover:text-white hover:bg-theme-bg-hover rounded-md transition-all duration-300"
              title="Edit Settings"
            >
              <Gear size={20} weight="bold" />
            </button>
          )}
        </div>
      </div>
      <SetupProvider
        portalRoot={document.getElementById(portalId)}
        isOpen={isOpen}
        llmProvider={llm}
        closeModal={closeModal}
        onSaved={onClick}
        settings={currentSettings}
      />
    </>
  );
}
