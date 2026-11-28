import { DownloadSimple, Key } from "@phosphor-icons/react";
import { saveAs } from "file-saver";
import { useState } from "react";
import { Dialog } from "@headlessui/react";
import { useTranslation } from "react-i18next";
import showToast from "@/utils/toast";

export default function RecoveryCodeModal({
  recoveryCodes,
  onDownloadComplete,
  onClose,
}: {
  recoveryCodes: string[];
  onDownloadComplete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [downloadClicked, setDownloadClicked] = useState(false);
  const download = () => {
    saveAs(
      new Blob([recoveryCodes.join("\n")], { type: "text/plain" }),
      "recovery_codes.txt"
    );
    setDownloadClicked(true);
  };
  const finish = () => {
    if (!downloadClicked) return;
    onDownloadComplete();
    onClose();
  };
  const copy = async () => {
    let copied = false;
    try {
      const { copyTextToClipboard } = await import("@/utils/clipboard");
      copied = await copyTextToClipboard(recoveryCodes.join("\n"));
    } catch {
      copied = false;
    }
    showToast(
      t(copied ? "auth_page.codes_copied" : "auth_page.codes_copy_failed"),
      copied ? "success" : "error",
      { clear: true }
    );
  };
  return (
    <Dialog open onClose={() => {}} className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
        <Dialog.Panel className="w-full max-w-lg rounded-2xl border border-theme-sidebar-border bg-theme-bg-primary p-6 text-theme-text-primary">
          <Dialog.Title className="flex items-center gap-3 text-xl font-semibold">
            <Key size={24} />
            {t("auth_page.codes_title")}
          </Dialog.Title>
          <Dialog.Description className="mt-4 text-sm leading-6 text-theme-text-secondary">
            {t("auth_page.codes_description")}
          </Dialog.Description>
          <ul className="my-6 max-h-[35dvh] overflow-y-auto rounded-lg bg-theme-bg-chat-input p-4 font-mono text-xs leading-6">
            {recoveryCodes.map((code, index) => (
              <li key={index} className="break-all">
                {code}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={copy}
              className="dsh-control min-h-[44px] rounded-lg px-4 text-sm hover:bg-theme-sidebar-subitem-hover focus-visible:ring-2 focus-visible:ring-primary-button"
            >
              {t("auth_page.codes_copy")}
            </button>
            <button
              type="button"
              onClick={downloadClicked ? finish : download}
              className="flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-button px-4 text-sm font-medium text-black hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary-button focus-visible:ring-offset-2"
            >
              {!downloadClicked && <DownloadSimple size={18} />}
              {t(
                downloadClicked
                  ? "auth_page.codes_continue"
                  : "auth_page.codes_download"
              )}
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
