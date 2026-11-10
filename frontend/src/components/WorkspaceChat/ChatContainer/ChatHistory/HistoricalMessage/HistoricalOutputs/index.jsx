import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import FileDownloadCard from "../../FileDownloadCard";
import ScheduledJobCreatedCard from "../../ScheduledJobCreatedCard";

function HistoricalOutputs({ outputs = [] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (!outputs || outputs.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-4">
      {outputs.some((output) => output.type === "workspaceFile") && (
        <p className="text-sm font-medium text-theme-text-primary">
          {t("chat_window.file_download.results")}
        </p>
      )}
      {(expanded ? outputs : outputs.slice(0, 5)).map((output, index) => {
        const key = `${output.type}-${index}`;
        const cardProps = { content: output.payload, outputType: output.type };
        if (output.type === "scheduledJobCreated")
          return <ScheduledJobCreatedCard key={key} props={cardProps} />;
        return <FileDownloadCard key={key} props={cardProps} />;
      })}
      {outputs.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="self-start min-h-10 rounded-lg px-3 text-sm text-theme-text-secondary hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-button"
        >
          {t(
            expanded
              ? "chat_window.file_download.show_less"
              : "chat_window.file_download.show_all",
            { count: outputs.length }
          )}
        </button>
      )}
    </div>
  );
}

export default memo(HistoricalOutputs);
