import type { WorkspaceRecord } from "@/models/workspace";
import Workspace from "@/models/workspace";
import { workspaceSettingsFromForm } from "@/utils/types";
import showToast from "@/utils/toast";
import { useState } from "react";
import WorkspaceName from "./WorkspaceName";
import SuggestedChatMessages from "./SuggestedChatMessages";
import DeleteWorkspace from "./DeleteWorkspace";
import CTAButton from "@/components/lib/CTAButton";
import WorkspaceAccess from "./WorkspaceAccess";
import { useTranslation } from "react-i18next";

export default function GeneralInfo({
  workspace,
  onSaved,
  deletionProtected = false,
}: {
  workspace: WorkspaceRecord;
  deletionProtected?: boolean;
  onSaved: (updated: WorkspaceRecord) => void;
}) {
  const { t } = useTranslation();

  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    setSaving(true);
    e.preventDefault();
    const data = workspaceSettingsFromForm(e.currentTarget);
    const { workspace: updatedWorkspace, message } = await Workspace.update(
      workspace.slug,
      data
    );
    if (updatedWorkspace) {
      onSaved(updatedWorkspace);
      showToast(t("general.access.saved"), "success", { clear: true });
    } else {
      showToast(
        t("general.access.saveError", { message: message || "" }),
        "error",
        { clear: true }
      );
    }
    setSaving(false);
    setHasChanges(!updatedWorkspace);
  };

  return (
    <div className="w-full relative flex flex-col gap-y-[32px]">
      <form onSubmit={handleUpdate} className="w-full max-w-3xl flex flex-col">
        {hasChanges && (
          <div className="absolute top-0 right-0">
            <CTAButton type="submit">
              {saving ? t("common.saving") : t("common.save")}
            </CTAButton>
          </div>
        )}
        <WorkspaceName
          key={workspace.slug}
          workspace={workspace}
          setHasChanges={setHasChanges}
        />
        <div className="mt-8">
          <WorkspaceAccess
            workspace={workspace}
            setHasChanges={setHasChanges}
          />
        </div>
      </form>
      <SuggestedChatMessages slug={workspace.slug} />
      <DeleteWorkspace workspace={workspace} visible={!deletionProtected} />
    </div>
  );
}
