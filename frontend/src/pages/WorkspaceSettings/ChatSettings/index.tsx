import System, { type SystemKeys } from "@/models/system";
import Workspace, { type WorkspaceRecord } from "@/models/workspace";
import showToast from "@/utils/toast";
import { workspaceSettingsFromForm } from "@/utils/types";
import { useEffect, useState } from "react";
import ChatHistorySettings from "./ChatHistorySettings";
import ChatTemperatureSettings from "./ChatTemperatureSettings";
import ChatModeSelection from "./ChatModeSelection";
import WorkspaceProviderSelection from "../WorkspaceProviderSelection";
import CTAButton from "@/components/lib/CTAButton";

export default function ChatSettings({
  workspace,
  onSaved,
}: {
  workspace: WorkspaceRecord;
  onSaved: (updated: WorkspaceRecord) => void;
}) {
  const [settings, setSettings] = useState<SystemKeys>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function fetchSettings() {
      const _settings = await System.keys();
      setSettings(_settings ?? {});
    }
    fetchSettings();
  }, []);

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const data = workspaceSettingsFromForm(e.currentTarget);
    const { workspace: updatedWorkspace, message } = await Workspace.update(
      workspace.slug,
      data
    );
    if (updatedWorkspace) {
      onSaved(updatedWorkspace);
      showToast("Workspace updated!", "success", { clear: true });
      setHasChanges(false);
    } else {
      showToast(`Error: ${message}`, "error", { clear: true });
      // Keep hasChanges true on error so user can retry
    }
    setSaving(false);
  };

  if (!workspace) return null;
  return (
    <div id="workspace-chat-settings-container" className="relative">
      <form
        onSubmit={handleUpdate}
        id="chat-settings-form"
        className="flex w-full max-w-2xl flex-col gap-y-8"
      >
        {hasChanges && (
          <div className="absolute top-0 right-0">
            <CTAButton type="submit">
              {saving ? "Updating..." : "Update Workspace"}
            </CTAButton>
          </div>
        )}
        <WorkspaceProviderSelection
          settings={settings}
          workspace={workspace}
          setHasChanges={setHasChanges}
        />
        <ChatModeSelection />
        <ChatHistorySettings
          workspace={workspace}
          setHasChanges={setHasChanges}
        />
        <ChatTemperatureSettings
          settings={settings}
          workspace={workspace}
          setHasChanges={setHasChanges}
        />
      </form>
    </div>
  );
}
