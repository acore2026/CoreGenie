import { useTranslation } from "react-i18next";

export default function FormActions({ isEditing, saving, onClose }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between pt-4">
      <button
        type="button"
        onClick={onClose}
        className="h-9 rounded-lg border border-zinc-700 px-3.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 light:border-slate-600 light:text-slate-900 light:hover:bg-slate-100"
      >
        {t("scheduledJobs.modal.cancel")}
      </button>
      <button
        type="submit"
        disabled={saving}
        className="h-9 rounded-lg border-none bg-zinc-50 px-3.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-50 light:bg-slate-900 light:text-white light:hover:bg-slate-800"
      >
        {saving
          ? t("scheduledJobs.modal.saving")
          : isEditing
            ? t("scheduledJobs.modal.updateJob")
            : t("scheduledJobs.modal.createJob")}
      </button>
    </div>
  );
}
