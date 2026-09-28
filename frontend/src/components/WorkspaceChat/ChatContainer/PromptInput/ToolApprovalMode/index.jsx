import { useEffect, useState } from "react";
import { ShieldCheck, ShieldWarning } from "@phosphor-icons/react";
import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";
import AgentSkillWhitelist from "@/models/agentSkillWhitelist";
import useUser from "@/hooks/useUser";
import showToast from "@/utils/toast";

export default function ToolApprovalMode() {
  const { t } = useTranslation();
  const { user } = useUser();
  const [mode, setMode] = useState(
    AgentSkillWhitelist.APPROVAL_MODES.ALWAYS_ALLOW
  );
  const [loading, setLoading] = useState(true);
  const canManage = !user?.hasOwnProperty("role") || user.role === "admin";
  const alwaysAllow = mode === AgentSkillWhitelist.APPROVAL_MODES.ALWAYS_ALLOW;

  useEffect(() => {
    AgentSkillWhitelist.getApprovalMode()
      .then((result) => {
        if (result?.success) setMode(result.mode);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleMode() {
    if (loading || !canManage) return;
    const nextMode = alwaysAllow
      ? AgentSkillWhitelist.APPROVAL_MODES.ASK
      : AgentSkillWhitelist.APPROVAL_MODES.ALWAYS_ALLOW;
    setLoading(true);
    const result = await AgentSkillWhitelist.setApprovalMode(nextMode);
    if (result?.success) {
      setMode(result.mode);
    } else {
      showToast(
        result?.error || t("chat_window.tool_approval_mode.update_failed"),
        "error",
        { clear: true }
      );
    }
    setLoading(false);
  }

  const tooltip = !canManage
    ? t("chat_window.tool_approval_mode.admin_only")
    : alwaysAllow
      ? t("chat_window.tool_approval_mode.always_allow_tooltip")
      : t("chat_window.tool_approval_mode.ask_tooltip");

  return (
    <>
      <button
        id="tool-approval-mode"
        type="button"
        disabled={loading || !canManage}
        onClick={toggleMode}
        aria-pressed={alwaysAllow}
        aria-label={tooltip}
        data-tooltip-id="tool-approval-mode-tooltip"
        data-tooltip-content={tooltip}
        className={`group flex h-7 items-center justify-center gap-x-1 rounded-md border-none px-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary ${
          alwaysAllow
            ? "bg-amber-500/10 text-amber-300 light:text-amber-700"
            : "text-theme-text-secondary hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary"
        } ${loading || !canManage ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        {alwaysAllow ? (
          <ShieldWarning size={16} weight="fill" />
        ) : (
          <ShieldCheck size={16} />
        )}
        <span className="hidden md:inline text-xs font-medium whitespace-nowrap">
          {alwaysAllow
            ? t("chat_window.tool_approval_mode.always_allow")
            : t("chat_window.tool_approval_mode.ask")}
        </span>
      </button>
      <Tooltip
        id="tool-approval-mode-tooltip"
        place="bottom"
        delayShow={300}
        className="tooltip !text-xs z-99 max-w-[280px]"
      />
    </>
  );
}
