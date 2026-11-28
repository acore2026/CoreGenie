import { CircleNotch } from "@phosphor-icons/react";
import ModalWrapper from "@/components/ModalWrapper";
import { useTranslation } from "react-i18next";
import { numberWithCommas } from "@/utils/numbers";
import useUser from "@/hooks/useUser";
import { Link } from "react-router-dom";
import Paths from "@/utils/paths";

export default function FileUploadWarningModal({
  show,
  onClose,
  onContinue,
  onEmbed,
  tokenCount,
  maxTokens,
  fileCount = 1,
  isEmbedding = false,
  embedProgress = 0,
}: {
  show: boolean;
  onClose: () => void;
  onContinue: () => void;
  onEmbed: () => void;
  tokenCount: number;
  maxTokens: number;
  fileCount?: number;
  isEmbedding?: boolean;
  embedProgress?: number;
}) {
  const { t } = useTranslation();
  const { user } = useUser();
  const canEmbed = !user || user.role !== "default";
  if (!show) return null;

  if (isEmbedding) {
    return (
      <ModalWrapper isOpen={show}>
        <div className="relative max-w-[600px] bg-theme-bg-primary rounded-lg shadow border border-theme-modal-border">
          <div className="p-6 flex flex-col items-center justify-center">
            <p className="text-white text-lg font-semibold mb-4">
              {t("chat_window.upload_menu.embedding", {
                current: Math.min(embedProgress + 1, fileCount),
                total: fileCount,
              })}
            </p>
            <CircleNotch size={32} className="animate-spin text-white" />
            <p className="text-white/60 text-sm mt-2">
              {t("chat_window.upload_menu.embedding_wait")}
            </p>
          </div>
        </div>
      </ModalWrapper>
    );
  }

  return (
    <ModalWrapper isOpen={show}>
      <div className="relative max-w-[600px] bg-theme-bg-primary rounded-lg shadow border border-theme-modal-border">
        <div className="relative p-6 border-b border-theme-modal-border">
          <div className="w-full flex gap-x-2 items-center">
            <h3 className="text-xl font-semibold text-white overflow-hidden overflow-ellipsis whitespace-nowrap">
              {t("chat_window.upload_menu.context_title")}
            </h3>
          </div>
        </div>

        <div className="py-7 px-9 space-y-4">
          <p className="text-theme-text-primary text-sm">
            {t("chat_window.upload_menu.context_usage", {
              count: fileCount,
              used: numberWithCommas(tokenCount),
              limit: numberWithCommas(maxTokens),
            })}{" "}
            <Link
              target="_blank"
              to={Paths.documentation.contextWindows()}
              className="text-theme-text-secondary text-sm underline"
            >
              {t("chat_window.upload_menu.context_help")}
            </Link>
          </p>
          <p className="text-theme-text-primary text-sm">
            {t("chat_window.upload_menu.context_limit_description")}
          </p>
        </div>

        <div className="flex w-full justify-between items-center p-6 space-x-2 border-t border-theme-modal-border rounded-b">
          <button
            onClick={onClose}
            type="button"
            className="border-none transition-all duration-300 bg-theme-modal-border text-white hover:opacity-60 px-4 py-2 rounded-lg text-sm"
          >
            {t("common.cancel")}
          </button>
          <div className="flex w-full justify-end items-center space-x-2">
            <button
              onClick={onContinue}
              type="button"
              className="border-none transition-all duration-300 bg-theme-modal-border text-white hover:opacity-60 px-4 py-2 rounded-lg text-sm"
            >
              {t("chat_window.upload_menu.continue")}
            </button>
            {canEmbed && (
              <button
                onClick={onEmbed}
                disabled={isEmbedding || !canEmbed}
                type="button"
                className="border-none transition-all duration-300 bg-white text-black hover:opacity-60 px-4 py-2 rounded-lg text-sm"
              >
                {t("chat_window.upload_menu.embed")}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalWrapper>
  );
}
