import { useEffect, useMemo, useState } from "react";
import { CaretDown, CircleNotch } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import useUser from "@/hooks/useUser";
import useGetProviderModels, {
  DISABLED_PROVIDERS,
} from "@/hooks/useGetProvidersModels";
import Workspace from "@/models/workspace";
import System from "@/models/system";
import showToast from "@/utils/toast";

function normalizeModels(defaultModels, customModels, selectedModel) {
  const models = [
    ...defaultModels.map((model) => ({ id: model, name: model })),
    ...(Array.isArray(customModels)
      ? customModels
      : Object.values(customModels ?? {}).flat()),
  ];
  const uniqueModels = new Map();

  for (const model of models) {
    const id = typeof model === "string" ? model : model?.id;
    if (!id || uniqueModels.has(id)) continue;
    uniqueModels.set(id, {
      id,
      name: typeof model === "string" ? model : model.name || id,
    });
  }

  if (selectedModel && !uniqueModels.has(selectedModel)) {
    uniqueModels.set(selectedModel, { id: selectedModel, name: selectedModel });
  }

  return Array.from(uniqueModels.values());
}

export default function WorkspaceModelPicker({ workspaceSlug = null }) {
  const { t } = useTranslation();
  const { user } = useUser();
  const [provider, setProvider] = useState(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);
  const { defaultModels, customModels, loading } =
    useGetProviderModels(provider);

  useEffect(() => {
    if (!workspaceSlug) return;

    Promise.all([Workspace.bySlug(workspaceSlug), System.keys()]).then(
      ([workspace, systemSettings]) => {
        setProvider(workspace.chatProvider ?? systemSettings?.LLMProvider);
        setSelectedModel(workspace.chatModel ?? systemSettings?.LLMModel ?? "");
      }
    );
  }, [workspaceSlug]);

  const models = useMemo(
    () => normalizeModels(defaultModels, customModels, selectedModel),
    [defaultModels, customModels, selectedModel]
  );
  const selectedLabel = useMemo(
    () =>
      models.find((model) => model.id === selectedModel)?.name ||
      selectedModel ||
      t("chat_window.select_model"),
    [models, selectedModel, t]
  );
  async function changeModel(event) {
    const nextModel = event.target.value;
    const previousModel = selectedModel;
    setSelectedModel(nextModel);
    setSaving(true);

    const { message } = await Workspace.update(workspaceSlug, {
      chatModel: nextModel,
    });

    if (message) {
      setSelectedModel(previousModel);
      showToast(message, "error", { clear: true });
    }
    setSaving(false);
  }

  // Workspace model changes are shared, so retain the existing admin-only rule.
  if (!!user && user.role !== "admin") return null;
  if (!workspaceSlug || !provider || DISABLED_PROVIDERS.includes(provider))
    return null;

  return (
    <div className="relative inline-grid h-6 min-w-[64px] max-w-[120px] shrink overflow-hidden md:max-w-[220px]">
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 whitespace-nowrap py-0 pl-2 pr-7 text-right text-xs font-medium"
      >
        {selectedLabel}
      </span>
      <select
        value={selectedModel}
        onChange={changeModel}
        disabled={loading || saving || models.length === 0}
        aria-label={t("chat_window.select_model")}
        title={selectedModel || t("chat_window.select_model")}
        className="absolute inset-0 h-6 w-full min-w-0 cursor-pointer appearance-none truncate rounded-full border-none bg-transparent py-0 pl-2 pr-7 text-right text-xs font-medium text-theme-text-secondary outline-none hover:bg-theme-bg-secondary disabled:cursor-wait disabled:opacity-60"
      >
        {models.length === 0 && (
          <option value="">{t("chat_window.select_model")}</option>
        )}
        {models.map((model) => (
          <option
            key={model.id}
            value={model.id}
            className="bg-theme-bg-chat-input text-theme-text-primary"
          >
            {model.name}
          </option>
        ))}
      </select>
      {loading || saving ? (
        <CircleNotch
          size={13}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-theme-text-secondary"
        />
      ) : (
        <CaretDown
          size={12}
          weight="bold"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-secondary"
        />
      )}
    </div>
  );
}
