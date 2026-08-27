import { useEffect, useRef, useState } from "react";
import { Check, CircleNotch, ShareNetwork } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import PublicChatShare from "@/models/publicChatShare";
import { copyTextToClipboard } from "@/utils/clipboard";
import showToast from "@/utils/toast";

export default function ShareChatButton({ workspace, threadSlug = null }) {
  const { t } = useTranslation();
  const [state, setState] = useState("idle");
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function shareChat() {
    if (!workspace?.slug || state === "sharing") return;
    setState("sharing");

    const result = await PublicChatShare.create({
      workspaceSlug: workspace.slug,
      threadSlug,
    });
    if (!result.success || !result.shareUrlPath) {
      setState("idle");
      showToast(t("chat_window.share_chat.error"), "error");
      return;
    }

    try {
      const publicUrl = new URL(result.shareUrlPath, window.location.origin)
        .href;
      await copyTextToClipboard(publicUrl);
      setState("copied");
      showToast(t("chat_window.share_chat.copied"), "success");
      resetTimer.current = setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("idle");
      showToast(t("chat_window.share_chat.copy_error"), "error");
    }
  }

  const isSharing = state === "sharing";
  const isCopied = state === "copied";

  return (
    <button
      type="button"
      onClick={shareChat}
      disabled={isSharing}
      title={t("chat_window.share_chat.tooltip")}
      aria-label={t("chat_window.share_chat.button")}
      className={`group h-[35px] px-3 rounded-full flex items-center gap-1.5 border text-sm font-semibold shadow-sm transition-all disabled:cursor-wait disabled:opacity-80 ${
        isCopied
          ? "bg-emerald-400 border-emerald-300 text-emerald-950"
          : "bg-amber-400 hover:bg-amber-300 border-amber-300 text-zinc-950 hover:shadow-md"
      }`}
    >
      {isSharing ? (
        <CircleNotch size={17} weight="bold" className="animate-spin" />
      ) : isCopied ? (
        <Check size={17} weight="bold" />
      ) : (
        <ShareNetwork size={17} weight="bold" />
      )}
      <span className="hidden sm:inline whitespace-nowrap">
        {isSharing
          ? t("chat_window.share_chat.sharing")
          : isCopied
            ? t("chat_window.share_chat.copied_short")
            : t("chat_window.share_chat.button")}
      </span>
    </button>
  );
}
