import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Toggle from "@/components/lib/Toggle";
import Admin from "@/models/admin";
import System from "@/models/system";
import showToast from "@/utils/toast";

export default function ContextCompaction() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const settings = await System.keys();
      if (!settings) throw new Error("SETTINGS_UNAVAILABLE");
      setEnabled(settings.AgentContextCompactionEnabled === true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleEnabled(next) {
    if (loading || saving || loadError) return;
    setSaving(true);
    try {
      const result = await Admin.updateSystemPreferences({
        agent_context_compaction_enabled: String(next),
      });
      if (!result?.success) throw new Error("SAVE_FAILED");
      setEnabled(next);
      showToast(
        t(
          next
            ? "agent.settings.context-compaction.enabled-toast"
            : "agent.settings.context-compaction.disabled-toast"
        ),
        "success",
        { clear: true }
      );
    } catch {
      showToast(t("agent.settings.context-compaction.error-toast"), "error", {
        clear: true,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onChange={(event) => event.stopPropagation()}
      aria-busy={loading || saving}
      className="flex flex-col gap-y-3 rounded-lg border border-theme-modal-border p-4"
    >
      <Toggle
        variant="horizontal"
        size="lg"
        label={t("agent.settings.context-compaction.title")}
        description={t("agent.settings.context-compaction.description")}
        labelClassName="!text-sm !leading-5"
        descriptionClassName="!text-xs !leading-[18px]"
        gapClassName="gap-2"
        enabled={enabled}
        disabled={loading || saving || loadError}
        onChange={toggleEnabled}
      />
      {loadError && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <p role="alert" className="text-red-400">
            {t("agent.settings.context-compaction.load-error")}
          </p>
          <button
            type="button"
            onClick={load}
            className="rounded px-2 py-1 text-theme-text-primary hover:bg-theme-bg-secondary focus-visible:outline focus-visible:outline-2"
          >
            {t("agent.settings.context-compaction.retry")}
          </button>
        </div>
      )}
    </div>
  );
}
