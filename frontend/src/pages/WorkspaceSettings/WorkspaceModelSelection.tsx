import useGetProviderModels, {
  type ProviderModel,
  DISABLED_PROVIDERS,
} from "@/hooks/useGetProvidersModels";
import type { WorkspaceRecord } from "@/models/workspace";
import { useTranslation } from "react-i18next";
function supportedModel(provider: string, model = "") {
  if (provider === "openai") {
    return (
      [
        "gpt-3.5-turbo-0301",
        "gpt-4-turbo-2024-04-09",
        "gpt-4-turbo",
        "o1-preview",
        "o1-preview-2024-09-12",
        "o1-mini",
        "o1-mini-2024-09-12",
        "o3-mini",
        "o3-mini-2025-01-31",
      ].includes(model) === false
    );
  }

  return true;
}

export default function WorkspaceModelSelection({
  provider,
  workspace,
  agent,
  setHasChanges,
}: {
  provider: string;
  workspace: WorkspaceRecord;
  agent: boolean;
  setHasChanges: (value: boolean) => void;
}) {
  const { defaultModels, customModels, downloadedModels, loading } =
    useGetProviderModels(provider);
  const { t } = useTranslation();
  if (DISABLED_PROVIDERS.includes(provider)) return null;
  const field = agent ? "agentModel" : "chatModel";
  function option(model: ProviderModel) {
    const id = typeof model === "string" ? model : model.id;
    if (agent && !supportedModel(provider, id)) return null;
    return (
      <option key={id} value={id}>
        {typeof model === "string" ? model : model.name || id}
      </option>
    );
  }
  const groups: [string, ProviderModel[]][] = [
    [t("workspace_model.general"), defaultModels],
    [t("workspace_model.downloaded"), downloadedModels],
    ...(Array.isArray(customModels)
      ? [
          [t("workspace_model.discovered"), customModels] as [
            string,
            ProviderModel[],
          ],
        ]
      : Object.entries(customModels)),
  ];
  return (
    <div className="flex flex-col gap-y-2">
      <label htmlFor={field} className="block input-label">
        {t(agent ? "agent.mode.title" : "chat.model.title")}
      </label>
      <p className="text-white text-opacity-60 text-xs font-medium">
        {t(agent ? "agent.mode.description" : "chat.model.description")}
      </p>
      <select
        key={loading ? "loading" : "ready"}
        id={field}
        name={field}
        disabled={loading}
        required
        defaultValue={workspace[field] ?? undefined}
        onChange={() => setHasChanges(true)}
        className="border-none bg-theme-settings-input-bg text-white text-sm rounded-lg focus:outline-primary-button block w-full p-2.5"
      >
        {loading ? (
          <option>{t("agent.mode.wait")}</option>
        ) : (
          groups
            .filter(([, models]) => models.length)
            .map(([label, models]) => (
              <optgroup key={label} label={label}>
                {models.map(option)}
              </optgroup>
            ))
        )}
      </select>
    </div>
  );
}
