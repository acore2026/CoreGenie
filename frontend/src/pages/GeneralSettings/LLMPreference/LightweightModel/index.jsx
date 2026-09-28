import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Admin from "@/models/admin";
import showToast from "@/utils/toast";

export default function LightweightModel() {
  const { t } = useTranslation();
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const load = async () => {
    setLoading(true);
    const result = await Admin.systemPreferencesByFields([
      "lightweight_model_provider",
      "lightweight_model_name",
    ]);
    setError(!result?.settings);
    if (result?.settings) {
      const next = {
        provider: result.settings.lightweight_model_provider || "",
        model: result.settings.lightweight_model_name || "",
      };
      setProvider(next.provider);
      setModel(next.model);
      setSaved(next);
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);
  const changed =
    saved && (saved.provider !== provider || saved.model !== model.trim());
  const save = async () => {
    setSaving(true);
    const result = await Admin.updateSystemPreferences({
      lightweight_model_provider: provider,
      lightweight_model_name: model.trim(),
    });
    setSaving(false);
    if (!result?.success)
      return showToast(
        result?.error || t("lightweight_model.save_error"),
        "error"
      );
    setSaved({ provider, model: model.trim() });
    setModel(model.trim());
    showToast(t("lightweight_model.saved"), "success");
  };
  return (
    <section
      className="mt-8 w-full max-w-[640px] rounded-lg border border-theme-sidebar-border p-4 text-theme-text-primary"
      aria-labelledby="lightweight-model-title"
    >
      <h2 id="lightweight-model-title" className="text-sm font-semibold">
        {t("lightweight_model.title")}
      </h2>
      <p className="mt-2 text-xs leading-5 text-theme-text-secondary">
        {t("lightweight_model.description")}
      </p>
      {error ? (
        <div className="mt-3 text-xs" role="alert">
          {t("lightweight_model.load_error")}{" "}
          <button
            type="button"
            onClick={load}
            className="dsh-control px-3 py-2"
          >
            {t("lightweight_model.retry")}
          </button>
        </div>
      ) : (
        <>
          <fieldset
            disabled={loading || saving}
            className="mt-4 grid gap-4 sm:grid-cols-2 disabled:opacity-60"
          >
            <label className="flex flex-col gap-2 text-xs">
              {t("lightweight_model.provider")}
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="dsh-control min-h-10 px-3"
              >
                <option value="">{t("lightweight_model.inherit")}</option>
                <option value="openai">OpenAI</option>
                <option value="generic-openai">
                  {t("lightweight_model.compatible")}
                </option>
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-xs">
              {t("lightweight_model.model")}
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!provider || loading || saving}
                maxLength={200}
                autoComplete="off"
                className="dsh-control min-h-10 min-w-0 px-3"
                placeholder={t("lightweight_model.placeholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
            </label>
          </fieldset>
          <p className="mt-3 text-xs leading-5 text-theme-text-secondary">
            {t("lightweight_model.help")}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={
              loading || saving || !changed || (!!provider && !model.trim())
            }
            className="dsh-control mt-4 min-h-10 px-4 text-xs hover:bg-theme-sidebar-subitem-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(
              loading
                ? "lightweight_model.loading"
                : saving
                  ? "lightweight_model.saving"
                  : "lightweight_model.save"
            )}
          </button>
        </>
      )}
    </section>
  );
}
