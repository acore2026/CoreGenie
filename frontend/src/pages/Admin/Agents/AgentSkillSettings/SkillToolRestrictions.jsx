import { useEffect, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Toggle from "@/components/lib/Toggle";
import Admin from "@/models/admin";
import System from "@/models/system";
import showToast from "@/utils/toast";

export default function SkillToolRestrictions() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    System.keys()
      .then((settings) => {
        setEnabled(settings?.AgentSkillToolRestrictionsEnabled === true);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleEnabled(next) {
    setSaving(true);
    const result = await Admin.updateSystemPreferences({
      agent_skill_tool_restrictions_enabled: String(next),
    });
    if (result?.success) {
      setEnabled(next);
      showToast(
        t(
          next
            ? "agent.settings.skill-tool-restrictions.enabled-toast"
            : "agent.settings.skill-tool-restrictions.disabled-toast"
        ),
        "success",
        { clear: true }
      );
    } else {
      showToast(
        result?.error ||
          t("agent.settings.skill-tool-restrictions.error-toast"),
        "error",
        { clear: true }
      );
    }
    setSaving(false);
  }

  return (
    <div
      onChange={(event) => event.stopPropagation()}
      className="flex flex-col gap-y-3 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-4"
    >
      <p className="text-md font-medium text-theme-text-primary">
        {t("agent.settings.skill-tool-restrictions.title")}
      </p>
      <div className="flex items-start justify-between gap-x-4">
        <p className="max-w-[380px] text-xs leading-[18px] text-theme-text-secondary">
          {t("agent.settings.skill-tool-restrictions.description")}
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
