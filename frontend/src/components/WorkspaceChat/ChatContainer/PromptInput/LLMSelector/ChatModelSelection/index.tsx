import useGetProviderModels, {
  DISABLED_PROVIDERS,
  type ProviderModel,
} from "@/hooks/useGetProvidersModels";

function modelOption(model: ProviderModel) {
  const id = typeof model === "string" ? model : model.id;
  return (
    <option key={id} value={id}>
      {typeof model === "string" ? model : model.name || id}
    </option>
  );
}

export default function ChatModelSelection({
  provider,
  setHasChanges,
  selectedLLMModel,
  setSelectedLLMModel,
}: {
  provider: string | null;
  setHasChanges: (value: boolean) => void;
  selectedLLMModel: string;
  setSelectedLLMModel: (model: string) => void;
}) {
  const { defaultModels, customModels, loading, downloadedModels } =
    useGetProviderModels(provider);
  if (provider && DISABLED_PROVIDERS.includes(provider)) return null;

  if (loading) {
    return (
      <select
        required={true}
        disabled={true}
        className="bg-zinc-900 light:bg-white text-white light:text-slate-900 text-sm rounded-lg h-8 w-full px-2.5 outline-none border border-zinc-900 light:border-slate-400 cursor-not-allowed"
      >
        <option disabled={true}>-- waiting for models --</option>
      </select>
    );
  }

  return (
    <select
      id="workspace-llm-model-select"
      required={true}
      value={selectedLLMModel}
      onChange={(e) => {
        setHasChanges(true);
        setSelectedLLMModel(e.target.value);
      }}
      className="bg-zinc-900 light:bg-white text-white light:text-slate-900 text-sm rounded-lg h-8 w-full px-2.5 outline-none border border-zinc-900 light:border-slate-400 cursor-pointer"
    >
      {defaultModels.length > 0 && (
        <optgroup label="General models">
          {defaultModels.map(modelOption)}
        </optgroup>
      )}
      {downloadedModels.length > 0 && (
        <optgroup label="Downloaded models">
          {downloadedModels.map(modelOption)}
        </optgroup>
      )}
      {Array.isArray(customModels) && customModels.length > 0 && (
        <optgroup label="Discovered models">
          {customModels.map(modelOption)}
        </optgroup>
      )}
      {/* For providers like TogetherAi where we partition model by creator entity. */}
      {!Array.isArray(customModels) && Object.keys(customModels).length > 0 && (
        <>
          {Object.entries(customModels).map(([organization, models]) => (
            <optgroup key={organization} label={organization}>
              {models.map(modelOption)}
            </optgroup>
          ))}
        </>
      )}
    </select>
  );
}
