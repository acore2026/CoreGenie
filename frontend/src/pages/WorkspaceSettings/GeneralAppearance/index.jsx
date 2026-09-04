import Workspace from "@/models/workspace";
import { castToType } from "@/utils/types";
import showToast from "@/utils/toast";
import { useEffect, useRef, useState } from "react";
import WorkspaceName from "./WorkspaceName";
import SuggestedChatMessages from "./SuggestedChatMessages";
import DeleteWorkspace from "./DeleteWorkspace";
import CTAButton from "@/components/lib/CTAButton";
import WorkspaceAccess from "./WorkspaceAccess";
import { useTranslation } from "react-i18next";

export default function GeneralInfo({ slug, deletionProtected = false }) {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const formEl = useRef(null);

  useEffect(() => {
    async function fetchWorkspace() {
      const workspace = await Workspace.bySlug(slug);
      setWorkspace(workspace);
      setLoading(false);
    }
    fetchWorkspace();
  }, [slug]);

  const handleUpdate = async (e) => {
    setSaving(true);
    e.preventDefault();
    const data = {};
    const form = new FormData(formEl.current);
    for (var [key, value] of form.entries()) data[key] = castToType(key, value);
    const { workspace: updatedWorkspace, message } = await Workspace.update(
      workspace.slug,
      data
    );
    if (!!updatedWorkspace) {
      showToast(t("general.access.saved"), "success", { clear: true });
    } else {
      showToast(
        t("general.access.saveError", { message: message || "" }),
        "error",
        { clear: true }
      );
    }
    setSaving(false);
    setHasChanges(false);
  };

  if (!workspace || loading) return null;
  return (
    <div className="w-full relative flex flex-col gap-y-[32px]">
      <form
        ref={formEl}
        onSubmit={handleUpdate}
        className="w-full max-w-3xl flex flex-col"
      >
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
