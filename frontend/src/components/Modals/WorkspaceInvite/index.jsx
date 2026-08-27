import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  Check,
  CircleNotch,
  Copy,
  LinkSimple,
  UserPlus,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import ModalWrapper from "@/components/ModalWrapper";
import Workspace from "@/models/workspace";
import { copyTextToClipboard } from "@/utils/clipboard";
import showToast from "@/utils/toast";

export default function WorkspaceInviteModal({ workspace, hideModal }) {
  const { t } = useTranslation();
  const requestedWorkspaceRef = useRef(null);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const inviteLink = invite?.code
    ? `${window.location.origin}/accept-invite/${invite.code}`
    : "";

  const loadInvite = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await Workspace.createInvite(workspace.slug);
    setInvite(result.invite || null);
    setError(result.error || null);
    setLoading(false);
  }, [workspace.slug]);

  useEffect(() => {
    if (!workspace?.slug || requestedWorkspaceRef.current === workspace.slug)
      return;
    requestedWorkspaceRef.current = workspace.slug;
    loadInvite();
  }, [workspace?.slug, loadInvite]);

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await copyTextToClipboard(inviteLink);
      setCopied(true);
      showToast(t("workspace-invite.copied"), "success", { clear: true });
      window.setTimeout(() => setCopied(false), 2000);
    } catch (copyError) {
      console.error("Failed to copy workspace invite:", copyError);
      showToast(t("workspace-invite.copy-failed"), "error", { clear: true });
    }
  }

  return (
    <ModalWrapper isOpen={Boolean(workspace)}>
      <section className="relative mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-[0_28px_90px_rgba(0,0,0,0.6)] light:border-slate-200 light:bg-white">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300" />
        <header className="flex items-start gap-4 border-b border-white/10 px-6 pb-5 pt-7 light:border-slate-200">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-400/15 text-sky-300 light:bg-sky-100 light:text-sky-700">
            <UserPlus size={23} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-theme-text-primary">
              {t("workspace-invite.title")}
            </h2>
            <p className="mt-1 truncate text-sm text-theme-text-secondary">
              {workspace?.name}
            </p>
          </div>
          <button
            type="button"
            onClick={hideModal}
            aria-label={t("workspace-invite.close")}
            className="rounded-lg p-1.5 text-theme-text-secondary transition-colors hover:bg-white/10 hover:text-theme-text-primary light:hover:bg-slate-100"
          >
            <X size={20} weight="bold" />
          </button>
        </header>

        <div className="px-6 py-6">
          <p className="text-sm leading-6 text-theme-text-secondary">
            {t("workspace-invite.description")}
          </p>

          <div className="mt-5">
            {loading ? (
              <div className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-theme-text-secondary light:border-slate-200 light:bg-slate-50">
                <CircleNotch size={18} className="animate-spin" />
                {t("workspace-invite.generating")}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4">
                <p className="text-sm text-red-300 light:text-red-700">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={loadInvite}
                  className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-red-200 hover:text-white light:text-red-700 light:hover:text-red-900"
                >
                  <ArrowClockwise size={16} weight="bold" />
                  {t("workspace-invite.retry")}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-sky-400/25 bg-sky-400/[0.07] p-2 light:bg-sky-50">
                <LinkSimple
                  size={19}
                  className="ml-1 shrink-0 text-sky-300 light:text-sky-700"
                />
                <input
                  type="url"
                  value={inviteLink}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label={t("workspace-invite.link-label")}
                  className="min-w-0 flex-1 border-none bg-transparent px-1 py-2 text-sm text-theme-text-primary outline-none"
                />
                <button
                  type="button"
                  onClick={copyInviteLink}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 light:bg-slate-900 light:text-white light:hover:bg-slate-700"
                >
                  {copied ? (
                    <Check size={16} weight="bold" />
                  ) : (
                    <Copy size={16} weight="bold" />
                  )}
                  {copied
                    ? t("workspace-invite.copied-short")
                    : t("workspace-invite.copy")}
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-white/[0.035] px-3 py-2.5 text-xs leading-5 text-theme-text-secondary light:bg-slate-50">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            {t("workspace-invite.reusable")}
          </div>
        </div>
      </section>
    </ModalWrapper>
  );
}
