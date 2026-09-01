import { useEffect, useState } from "react";
import {
  Check,
  Smiley,
  SmileyMeh,
  SmileySad,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Workspace from "@/models/workspace";

const MAX_COMMENT_LENGTH = 500;
let reasonRequest = null;
let reasonsLoadedAt = 0;

function loadReasons() {
  if (!reasonRequest || Date.now() - reasonsLoadedAt > 60_000)
    reasonRequest = Workspace.agentFeedbackReasons().then((result) => {
      if (result?.error) reasonRequest = null;
      else reasonsLoadedAt = Date.now();
      return result;
    });
  return reasonRequest;
}

const ratings = [
  { value: "good", icon: Smiley, tone: "good" },
  { value: "neutral", icon: SmileyMeh, tone: "neutral" },
  { value: "bad", icon: SmileySad, tone: "bad" },
];

const toneClasses = {
  good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 light:text-emerald-700",
  neutral:
    "border-amber-400/30 bg-amber-400/10 text-amber-200 light:text-amber-700",
  bad: "border-rose-400/30 bg-rose-400/10 text-rose-200 light:text-rose-700",
};

export default function ResponseEvaluation({ chatId, slug, initialFeedback }) {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState(initialFeedback);
  const [draftRating, setDraftRating] = useState(
    initialFeedback?.rating || null
  );
  const [reasonCodes, setReasonCodes] = useState(
    initialFeedback?.reasonCodes || []
  );
  const [comment, setComment] = useState(initialFeedback?.comment || "");
  const [reasons, setReasons] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setFeedback(initialFeedback);
    setDraftRating(initialFeedback?.rating || null);
    setReasonCodes(initialFeedback?.reasonCodes || []);
    setComment(initialFeedback?.comment || "");
  }, [initialFeedback]);

  useEffect(() => {
    if (!expanded || reasons.length) return;
    let active = true;
    setLoadingReasons(true);
    loadReasons().then((result) => {
      if (!active) return;
      setReasons(result?.reasons || []);
      setError(result?.error ? t("agent_feedback.reasons_load_error") : "");
      setLoadingReasons(false);
    });
    return () => {
      active = false;
    };
  }, [expanded, reasons.length, t]);

  async function save(
    nextRating,
    nextReasons = reasonCodes,
    nextComment = comment
  ) {
    if (!chatId || !slug || saving) return;
    setSaving(true);
    setError("");
    const result = await Workspace.updateAgentFeedback(chatId, slug, {
      rating: nextRating,
      reasonCodes: nextRating === "good" ? [] : nextReasons,
      comment: nextComment,
    });
    setSaving(false);
    if (!result?.success) {
      setError(result?.error || t("agent_feedback.save_error"));
      return;
    }
    setFeedback(result.feedback);
    setDraftRating(result.feedback?.rating || null);
    setReasonCodes(result.feedback?.reasonCodes || []);
    setComment(result.feedback?.comment || "");
    setExpanded(false);
  }

  function selectRating(rating) {
    setError("");
    setDraftRating(rating);
    if (rating === "good") {
      save("good", [], comment);
      return;
    }
    setExpanded(true);
  }

  function toggleReason(code) {
    setReasonCodes((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code]
    );
    setError("");
  }

  function submitDetails() {
    if (["neutral", "bad"].includes(draftRating) && !reasonCodes.length) {
      setError(t("agent_feedback.reason_required"));
      return;
    }
    if (reasonCodes.includes("other") && !comment.trim()) {
      setError(t("agent_feedback.other_comment_required"));
      return;
    }
    save(draftRating, reasonCodes, comment.trim());
  }

  async function removeFeedback() {
    if (!feedback) {
      setDraftRating(null);
      setReasonCodes([]);
      setComment("");
      setExpanded(false);
      setError("");
      return;
    }
    await save(null, [], "");
  }

  if (!chatId || !slug) return null;

  return (
    <section
      aria-label={t("agent_feedback.title")}
      className="mt-4 max-w-2xl rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] p-3.5 shadow-[inset_3px_0_0_rgba(103,232,249,0.45)] light:border-cyan-700/15 light:bg-cyan-50/70 light:shadow-[inset_3px_0_0_rgba(8,145,178,0.35)] sm:p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-base light:border-cyan-700/15 light:bg-white/70"
        >
          💬
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold leading-5 text-theme-text-primary">
            {feedback
              ? t("agent_feedback.recorded")
              : t("agent_feedback.question")}
          </p>
          {!feedback && (
            <p className="m-0 mt-1 max-w-xl text-xs leading-5 text-cyan-100/75 light:text-cyan-900/70">
              {t("agent_feedback.question_help")}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ratings.map(({ value, icon: Icon, tone }) => {
              const selected =
                (expanded ? draftRating : feedback?.rating || draftRating) ===
                value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={saving}
                  onClick={() => selectRating(value)}
                  aria-pressed={selected}
                  className={`flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-300/40 disabled:cursor-wait disabled:opacity-50 ${
                    selected
                      ? toneClasses[tone]
                      : "border-white/10 bg-theme-bg-container/35 text-theme-text-secondary hover:border-cyan-200/25 hover:bg-cyan-200/[0.07] hover:text-theme-text-primary light:border-cyan-900/10 light:bg-white/70 light:hover:bg-white"
                  }`}
                >
                  <Icon size={17} weight={selected ? "fill" : "regular"} />
                  {t(`agent_feedback.ratings.${value}`)}
                </button>
              );
            })}
            {saving && (
              <SpinnerGap
                size={16}
                className="animate-spin text-theme-text-secondary"
                aria-label={t("agent_feedback.saving")}
              />
            )}
            {feedback && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="min-h-10 px-2 text-xs text-theme-text-secondary underline-offset-4 hover:text-theme-text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
              >
                {t("agent_feedback.edit")}
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-cyan-200/15 pt-4 light:border-cyan-900/10">
          {draftRating !== "good" && (
            <div>
              <p className="mb-2 text-xs font-medium text-theme-text-primary">
                {t("agent_feedback.reason_label")}
              </p>
              {loadingReasons ? (
                <p className="text-xs text-theme-text-secondary">
                  {t("agent_feedback.reasons_loading")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {reasons
                    .filter(
                      (reason) =>
                        reason.enabled || reasonCodes.includes(reason.code)
                    )
                    .map((reason) => {
                      const selected = reasonCodes.includes(reason.code);
                      return (
                        <button
                          key={reason.code}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleReason(reason.code)}
                          className={`min-h-9 rounded-lg border px-3 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-300/30 ${
                            selected
                              ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-200 light:text-cyan-700"
                              : "border-white/10 bg-theme-bg-container/35 text-theme-text-secondary hover:border-white/20 light:border-cyan-900/10 light:bg-white/70"
                          }`}
                        >
                          {selected && (
                            <Check size={13} className="mr-1 inline" />
                          )}
                          {reason.label}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          <label className="mt-3 block text-xs font-medium text-theme-text-primary">
            {t("agent_feedback.comment_label")}
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={MAX_COMMENT_LENGTH}
              rows={3}
              placeholder={t("agent_feedback.comment_placeholder")}
              className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-theme-settings-input-bg px-3 py-2 text-xs leading-5 text-theme-text-primary outline-none placeholder:text-theme-settings-input-placeholder focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10 light:border-cyan-900/15"
            />
          </label>
          <div className="mt-1 text-right text-[11px] tabular-nums text-theme-text-secondary">
            {comment.length} / {MAX_COMMENT_LENGTH}
          </div>
          {error && (
            <p
              role="alert"
              className="mt-2 text-xs text-rose-300 light:text-rose-700"
            >
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap justify-between gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={removeFeedback}
              className="min-h-10 px-2 text-xs text-theme-text-secondary hover:text-rose-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/30 disabled:opacity-50"
            >
              {feedback
                ? t("agent_feedback.remove")
                : t("agent_feedback.cancel")}
            </button>
            <button
              type="button"
              disabled={saving || !draftRating || loadingReasons}
              onClick={submitDetails}
              className="min-h-10 rounded-lg bg-cyan-300 px-4 text-xs font-semibold text-zinc-950 transition hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? t("agent_feedback.saving") : t("agent_feedback.submit")}
            </button>
          </div>
        </div>
      )}
      {!expanded && error && (
        <p
          role="alert"
          className="mt-2 text-xs text-rose-300 light:text-rose-700"
        >
          {error}
        </p>
      )}
    </section>
  );
}
