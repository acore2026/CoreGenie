import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowsOut, ArrowsIn } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export default function FullscreenEditor({ children, title }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  function close() {
    dialogRef.current.close();
    setExpanded(false);
  }
  return (
    <div className="min-h-0 min-w-0">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          className="dsh-control flex items-center gap-2 px-3 py-2 text-xs"
          onClick={() => {
            setExpanded(true);
            dialogRef.current.showModal();
          }}
        >
          <ArrowsOut size={16} />
          {t("editor_view.expand")}
        </button>
      </div>
      {!expanded && children}
      {createPortal(
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          className="fullscreen-editor"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          {expanded && (
            <>
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-theme-sidebar-border px-5 py-3">
                <h2 id={titleId} className="text-base font-semibold">
                  {title}
                </h2>
                <button
                  type="button"
                  className="dsh-control flex items-center gap-2 px-3 py-2 text-sm"
                  onClick={close}
                >
                  <ArrowsIn size={16} />
                  {t("editor_view.collapse")}
                </button>
              </header>
              <div className="fullscreen-editor-content">{children}</div>
              <p className="shrink-0 px-5 py-2 text-xs text-theme-text-secondary">
                {t("editor_view.hint")}
              </p>
            </>
          )}
        </dialog>,
        document.body
      )}
    </div>
  );
}
