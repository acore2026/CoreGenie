import { useEffect, useState } from "react";
import { isMobile } from "react-device-detect";
import {
  ArrowDown,
  ArrowUp,
  ChartBar,
  Plus,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/SettingsSidebar";
import Admin from "@/models/admin";
import showToast from "@/utils/toast";

export default function AgentFeedbackSettings() {
  const { t } = useTranslation();
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  async function loadReasons() {
    setLoading(true);
    const result = await Admin.agentFeedbackReasons();
    setLoading(false);
    if (result?.error)
      return showToast(t("agent_feedback_settings.load_error"), "error");
    setReasons(result.reasons || []);
  }

  useEffect(() => {
    loadReasons();
  }, []);

  async function createReason(event) {
    event.preventDefault();
    if (!code.trim() || !label.trim()) return;
    setCreating(true);
    const result = await Admin.createAgentFeedbackReason({ code, label });
    setCreating(false);
    if (!result?.reason)
      return showToast(
        result?.error || t("agent_feedback_settings.create_error"),
        "error"
      );
    setCode("");
    setLabel("");
    setReasons((current) => [...current, result.reason]);
    showToast(t("agent_feedback_settings.created"), "success", { clear: true });
  }

  async function updateReason(id, updates) {
    const result = await Admin.updateAgentFeedbackReason(id, updates);
    if (!result?.reason) {
      showToast(
        result?.error || t("agent_feedback_settings.update_error"),
        "error"
      );
      return null;
    }
    setReasons((current) =>
      current
        .map((reason) => (reason.id === id ? result.reason : reason))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    );
    return result.reason;
  }

  async function moveReason(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= reasons.length) return;
    const current = reasons[index];
    const target = reasons[targetIndex];
    const [updatedCurrent, updatedTarget] = await Promise.all([
      Admin.updateAgentFeedbackReason(current.id, {
        sortOrder: target.sortOrder,
      }),
      Admin.updateAgentFeedbackReason(target.id, {
        sortOrder: current.sortOrder,
      }),
    ]);
    if (!updatedCurrent?.reason || !updatedTarget?.reason) {
      showToast(
        updatedCurrent?.error ||
          updatedTarget?.error ||
          t("agent_feedback_settings.update_error"),
        "error"
      );
      return;
    }
    const reordered = [...reasons];
    reordered[index] = updatedTarget.reason;
    reordered[targetIndex] = updatedCurrent.reason;
    setReasons(reordered);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-theme-bg-container md:mt-0 mt-6">
      <Sidebar />
      <main
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative flex w-full flex-col overflow-hidden md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px]"
      >
        <div className="flex h-full flex-col overflow-y-auto bg-theme-bg-secondary px-5 pb-8 pt-14 text-theme-text-primary md:px-8">
          <header className="mx-auto w-full max-w-5xl border-b border-white/[0.08] pb-6 light:border-slate-200">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300 light:bg-cyan-50 light:text-cyan-700">
                <ChartBar size={22} weight="duotone" />
              </span>
              <div>
                <h1 className="text-xl font-semibold">
                  {t("agent_feedback_settings.title")}
                </h1>
                <p className="mt-1 text-xs text-theme-text-secondary">
                  {t("agent_feedback_settings.description")}
                </p>
              </div>
            </div>
          </header>

          <div className="mx-auto mt-6 grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 light:border-slate-200 light:bg-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">
                    {t("agent_feedback_settings.reasons_title")}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-theme-text-secondary">
                    {t("agent_feedback_settings.reasons_help")}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] tabular-nums text-theme-text-secondary light:border-slate-200">
                  {reasons.filter((reason) => reason.enabled).length} / 12
                </span>
              </div>

              {loading ? (
                <div className="flex min-h-40 items-center justify-center text-theme-text-secondary">
                  <SpinnerGap size={22} className="animate-spin" />
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  {reasons.map((reason, index) => (
                    <ReasonRow
                      key={reason.id}
                      reason={reason}
                      first={index === 0}
                      last={index === reasons.length - 1}
                      onMove={(direction) => moveReason(index, direction)}
                      onUpdate={(updates) => updateReason(reason.id, updates)}
                    />
                  ))}
                </div>
              )}
            </section>

            <aside className="h-fit space-y-4">
              <form
                onSubmit={createReason}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 light:border-slate-200 light:bg-white"
              >
                <h2 className="text-sm font-semibold">
                  {t("agent_feedback_settings.add_title")}
                </h2>
                <label className="mt-4 block text-xs font-medium">
                  {t("agent_feedback_settings.label")}
                  <input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    maxLength={40}
                    placeholder={t("agent_feedback_settings.label_placeholder")}
                    className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-theme-settings-input-bg px-3 text-sm outline-none placeholder:text-theme-settings-input-placeholder focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10 light:border-slate-300"
                  />
                </label>
                <label className="mt-3 block text-xs font-medium">
                  {t("agent_feedback_settings.code")}
                  <input
                    value={code}
                    onChange={(event) =>
                      setCode(
                        event.target.value.toLowerCase().replace(/\s+/g, "-")
                      )
                    }
                    maxLength={23}
                    placeholder={t("agent_feedback_settings.code_placeholder")}
                    className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-theme-settings-input-bg px-3 font-mono text-xs outline-none placeholder:text-theme-settings-input-placeholder focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10 light:border-slate-300"
                  />
                </label>
                <p className="mt-2 text-[11px] leading-4 text-theme-text-secondary">
                  {t("agent_feedback_settings.code_help")}
                </p>
                <button
                  type="submit"
                  disabled={creating || !code.trim() || !label.trim()}
                  className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 text-xs font-semibold text-zinc-950 transition hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {creating ? (
                    <SpinnerGap size={16} className="animate-spin" />
                  ) : (
                    <Plus size={16} weight="bold" />
                  )}
                  {t("agent_feedback_settings.add")}
                </button>
              </form>

              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-xs leading-5 text-theme-text-secondary light:bg-amber-50">
                <p className="font-semibold text-amber-200 light:text-amber-800">
                  {t("agent_feedback_settings.sync_title")}
                </p>
                <p className="mt-1">{t("agent_feedback_settings.sync_help")}</p>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function ReasonRow({ reason, first, last, onMove, onUpdate }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(reason.label);
  const [saving, setSaving] = useState(false);

  useEffect(() => setLabel(reason.label), [reason.label]);

  async function saveLabel() {
    if (!label.trim() || label.trim() === reason.label) return;
    setSaving(true);
    const updated = await onUpdate({ label: label.trim() });
    setSaving(false);
    if (!updated) setLabel(reason.label);
  }

  async function toggleEnabled() {
    setSaving(true);
    await onUpdate({ enabled: !reason.enabled });
    setSaving(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] p-3 light:border-slate-200 sm:flex-nowrap sm:gap-3">
      <div className="order-3 flex basis-full items-center gap-1 sm:order-1 sm:basis-auto">
        <button
          type="button"
          disabled={first || saving}
          onClick={() => onMove(-1)}
          aria-label={t("agent_feedback_settings.move_up")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-theme-text-secondary hover:bg-white/[0.05] hover:text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-300/30 disabled:opacity-25 light:hover:bg-slate-100"
        >
          <ArrowUp size={15} />
        </button>
        <button
          type="button"
          disabled={last || saving}
          onClick={() => onMove(1)}
          aria-label={t("agent_feedback_settings.move_down")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-theme-text-secondary hover:bg-white/[0.05] hover:text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-300/30 disabled:opacity-25 light:hover:bg-slate-100"
        >
          <ArrowDown size={15} />
        </button>
      </div>
      <div className="order-1 min-w-0 flex-1 sm:order-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={40}
          disabled={saving}
          aria-label={t("agent_feedback_settings.label")}
          className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-white/10 focus:border-cyan-300/50 focus:bg-theme-settings-input-bg focus:ring-2 focus:ring-cyan-300/10 light:hover:border-slate-300"
        />
        <p className="px-2 font-mono text-[11px] text-theme-text-secondary">
          {reason.code}
        </p>
      </div>
      <div className="order-2 flex items-center justify-between gap-2 sm:order-3 sm:justify-end">
        {label.trim() !== reason.label && (
          <button
            type="button"
            disabled={saving || !label.trim()}
            onClick={saveLabel}
            className="min-h-9 rounded-lg border border-cyan-300/30 px-3 text-xs text-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/30 disabled:opacity-40 light:text-cyan-700"
          >
            {saving ? t("common.saving") : t("agent_feedback_settings.save")}
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={reason.enabled}
          disabled={saving || reason.code === "other"}
          onClick={toggleEnabled}
          className={`relative h-6 w-11 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-50 ${
            reason.enabled ? "bg-cyan-300" : "bg-zinc-600 light:bg-slate-300"
          }`}
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full bg-zinc-950 transition-transform ${
              reason.enabled ? "left-6" : "left-1"
            }`}
          />
          <span className="sr-only">
            {reason.enabled
              ? t("agent_feedback_settings.enabled")
              : t("agent_feedback_settings.disabled")}
          </span>
        </button>
      </div>
    </div>
  );
}
