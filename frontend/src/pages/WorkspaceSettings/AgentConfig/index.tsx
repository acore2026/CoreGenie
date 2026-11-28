import System, { type SystemKeys } from "@/models/system";
import Workspace, { type WorkspaceRecord } from "@/models/workspace";
import showToast from "@/utils/toast";
import { castToType } from "@/utils/types";
import { useEffect, useState } from "react";
import WorkspaceProviderSelection from "../WorkspaceProviderSelection";
import Admin from "@/models/admin";
import * as Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import paths from "@/utils/paths";
import useUser from "@/hooks/useUser";

export default function WorkspaceAgentConfiguration({
  workspace,
  onSaved,
}: {
  workspace: WorkspaceRecord;
  onSaved: (updated: WorkspaceRecord) => void;
}) {
  const { user } = useUser();
  const [settings, setSettings] = useState<SystemKeys>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSettings() {
      const _settings = await System.keys();
      setSettings(_settings ?? {});
      setLoading(false);
    }
    fetchSettings();
  }, []);

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    setSaving(true);
    e.preventDefault();
    const data: Record<
      "system" | "env" | "workspace",
      Record<string, unknown>
    > = {
      workspace: {},
      system: {},
      env: {},
    };

    const form = new FormData(e.currentTarget);
    for (const [key, value] of form.entries()) {
      if (key.startsWith("system::")) {
        const [, label] = key.split("system::");
        data.system[label] = String(value);
        continue;
      }

      if (key.startsWith("env::")) {
        const [, label] = key.split("env::");
        data.env[label] = String(value);
        continue;
      }

      data.workspace[key] = castToType(key, value);
    }

    const { workspace: updatedWorkspace, message } = await Workspace.update(
      workspace.slug,
      data.workspace
    );
    if (Object.keys(data.system).length)
      await Admin.updateSystemPreferences(data.system);
    if (Object.keys(data.env).length) await System.updateSystem(data.env);

    if (updatedWorkspace) {
      onSaved(updatedWorkspace);
      showToast("Workspace updated!", "success", { clear: true });
    } else {
      showToast(`Error: ${message}`, "error", { clear: true });
    }

    setSaving(false);
    setHasChanges(!updatedWorkspace);
  };

  if (!workspace || loading) return <LoadingSkeleton />;
  return (
    <div id="workspace-agent-settings-container">
      <form
        onSubmit={handleUpdate}
        onChange={() => setHasChanges(true)}
        id="agent-settings-form"
        className="flex w-full max-w-2xl flex-col gap-y-6"
      >
        <WorkspaceProviderSelection
          agent
          settings={settings}
          workspace={workspace}
          setHasChanges={setHasChanges}
        />
        {(!user || user?.role === "admin") && (
          <>
            {!hasChanges && (
              <div className="flex flex-col gap-y-4">
                <a
                  className="w-fit transition-all duration-300 border border-slate-200 px-5 py-2.5 rounded-lg text-white text-sm items-center flex gap-x-2 hover:bg-slate-200 hover:text-slate-800 focus:ring-gray-800"
                  href={paths.settings.agentSkills()}
                >
                  Configure Agent Skills
                </a>
                <p className="text-white text-opacity-60 text-xs font-medium">
                  Customize and enhance the default agent's capabilities by
                  enabling or disabling specific skills. These settings will be
                  applied across all workspaces.
                </p>
              </div>
            )}
          </>
        )}

        {hasChanges && (
          <button
            type="submit"
            form="agent-settings-form"
            className="w-fit transition-all duration-300 border border-slate-200 px-5 py-2.5 rounded-lg text-white text-sm items-center flex gap-x-2 hover:bg-slate-200 hover:text-slate-800 focus:ring-gray-800"
          >
            {saving ? "Updating agent..." : "Update workspace agent"}
          </button>
        )}
      </form>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div id="workspace-agent-settings-container">
      <div className="flex w-full max-w-2xl flex-col gap-y-6">
        <Skeleton.default
          height={100}
          width="100%"
          count={2}
          highlightColor="var(--theme-bg-primary)"
          baseColor="var(--theme-bg-secondary)"
          enableAnimation={true}
          containerClassName="flex flex-col gap-y-1"
        />
        <div className="bg-white/10 h-[1px] w-full" />
        <Skeleton.default
          height={100}
          width="100%"
          count={2}
          highlightColor="var(--theme-bg-primary)"
          baseColor="var(--theme-bg-secondary)"
          enableAnimation={true}
          containerClassName="flex flex-col gap-y-1 mt-4"
        />
      </div>
    </div>
  );
}
