import { FolderPlus } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import NewWorkspaceModal, {
  useNewWorkspaceModal,
} from "@/components/Modals/NewWorkspace";

export default function CreateWorkspaceGuide() {
  const { t } = useTranslation();
  const { showing, showModal, hideModal } = useNewWorkspaceModal();
  return (
    <section className="w-full rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-6 text-center">
      <FolderPlus
        size={32}
        className="mx-auto mb-3 text-cyan-400 light:text-cyan-700"
        aria-hidden="true"
      />
      <h2 className="text-lg font-semibold text-theme-text-primary">
        {t("home.createWorkspaceTitle")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-theme-text-secondary">
        {t("home.notAssigned")}
      </p>
      <button
        type="button"
        onClick={showModal}
        className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg-chat"
      >
        <FolderPlus size={18} aria-hidden="true" />
        {t("home.createWorkspace")}
      </button>
      {showing && <NewWorkspaceModal hideModal={hideModal} />}
    </section>
  );
}
