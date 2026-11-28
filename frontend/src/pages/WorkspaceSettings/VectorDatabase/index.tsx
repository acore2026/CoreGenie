import Workspace, { type WorkspaceRecord } from "@/models/workspace";
import showToast from "@/utils/toast";
import { workspaceSettingsFromForm } from "@/utils/types";
import { useState } from "react";
import VectorDBIdentifier from "./VectorDBIdentifier";
import MaxContextSnippets from "./MaxContextSnippets";
import DocumentSimilarityThreshold from "./DocumentSimilarityThreshold";
import ResetDatabase from "./ResetDatabase";
import VectorCount from "./VectorCount";
import VectorSearchMode from "./VectorSearchMode";
import CTAButton from "@/components/lib/CTAButton";

export default function VectorDatabase({
  workspace,
}: {
  workspace: WorkspaceRecord;
}) {
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
    if (!!updatedWorkspace) {
      showToast("Workspace updated!", "success", { clear: true });
    } else {
      showToast(`Error: ${message}`, "error", { clear: true });
    }
    setSaving(false);
    setHasChanges(!updatedWorkspace);
  };

  if (!workspace) return null;
  return (
    <div className="w-full relative">
      <form
        onSubmit={handleUpdate}
        className="flex w-full max-w-2xl flex-col gap-y-8"
      >
        {hasChanges && (
          <div className="absolute top-0 right-0">
            <CTAButton type="submit">
              {saving ? "Updating..." : "Update Workspace"}
            </CTAButton>
          </div>
        )}
        <div className="flex items-start gap-x-5">
          <VectorDBIdentifier workspace={workspace} />
          <VectorCount reload={true} workspace={workspace} />
        </div>
        <VectorSearchMode workspace={workspace} setHasChanges={setHasChanges} />
        <MaxContextSnippets
          workspace={workspace}
          setHasChanges={setHasChanges}
        />
        <DocumentSimilarityThreshold
          workspace={workspace}
          setHasChanges={setHasChanges}
        />
        <ResetDatabase workspace={workspace} />
      </form>
    </div>
  );
}
