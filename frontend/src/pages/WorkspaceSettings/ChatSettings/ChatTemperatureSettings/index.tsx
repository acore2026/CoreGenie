import type { SystemKeys } from "@/models/system";
import type { WorkspaceRecord } from "@/models/workspace";
import { useTranslation } from "react-i18next";
function recommendedSettings(provider?: string | null) {
  switch (provider) {
    case "mistral":
      return { temp: 0 };
    default:
      return { temp: 0.7 };
  }
}

export default function ChatTemperatureSettings({
  settings,
  workspace,
  setHasChanges,
}: {
  workspace: WorkspaceRecord;
  settings: SystemKeys;
  setHasChanges: (value: boolean) => void;
}) {
  const defaults = recommendedSettings(settings?.LLMProvider);
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex flex-col gap-y-[8px]">
        <label htmlFor="name" className="block input-label">
          {t("chat.temperature.title")}
        </label>
        <p className="text-white text-opacity-60 text-xs font-medium">
          {t("chat.temperature.desc-end")}
        </p>
      </div>
      <input
        name="openAiTemp"
        type="number"
        min={0.0}
        step={0.1}
        onWheel={(e) => e.currentTarget.blur()}
        defaultValue={workspace?.openAiTemp ?? defaults.temp}
        className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
        placeholder="0.7"
        required={true}
        autoComplete="off"
        onChange={() => setHasChanges(true)}
      />
    </div>
  );
}
