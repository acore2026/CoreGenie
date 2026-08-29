import { useEffect, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Toggle from "@/components/lib/Toggle";
import Admin from "@/models/admin";
import System from "@/models/system";
import showToast from "@/utils/toast";

export default function ExecutionLimitsOverride() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    System.keys()
      .then((settings) => {
        setEnabled(settings?.AgentExecutionLimitsDisabled === true);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleEnabled(next) {
    setSaving(true);
    const result = await Admin.updateSystemPreferences({
      agent_execution_limits_disabled: String(next),
    });
    if (result?.success) {
      setEnabled(next);
      showToast(
        t(
          next
            ? "agent.settings.execution-limits.enabled-toast"
            : "agent.settings.execution-limits.disabled-toast"
        ),
        "success",
        { clear: true }
      );
    } else {
      showToast(
        result?.error || t("agent.settings.execution-limits.error-toast"),
        "error",
        { clear: true }
      );
    }
    setSaving(false);
  }

  return (
    <div
      onChange={(event) => event.stopPropagation()}
      className="flex flex-col gap-y-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-4"
    >
      <div className="flex items-center gap-x-2">
        <p className="text-md font-medium text-theme-text-primary">
          {t("agent.settings.execution-limits.title")}
        </p>
        <span className="rounded-md bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 light:text-amber-700">
          {t("agent.settings.execution-limits.temporary")}
        </span>
      </div>
      <div className="flex items-start justify-between gap-x-4">
        <p className="max-w-[380px] text-xs leading-[18px] text-theme-text-secondary">
          {t("agent.settings.execution-limits.description")}
        </p>
        {loading ? (
          <CircleNotch
            size={18}
            className="mt-0.5 shrink-0 animate-spin text-theme-text-primary"
          />
        ) : (
          <Toggle
            size="lg"
            enabled={enabled}
            disabled={saving}
            onChange={toggleEnabled}
          />
        )}
      </div>
    </div>
  );
}
