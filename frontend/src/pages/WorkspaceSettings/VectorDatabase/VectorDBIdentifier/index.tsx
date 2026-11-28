import type { WorkspaceRecord } from "@/models/workspace";
import { useTranslation } from "react-i18next";

export default function VectorDBIdentifier({
  workspace,
}: {
  workspace: WorkspaceRecord;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="input-label">{t("vector-workspace.identifier")}</h3>
      <p className="text-white/60 text-xs font-medium py-1"> </p>
      <p className="text-white/60 text-sm">{workspace?.slug}</p>
    </div>
  );
}
