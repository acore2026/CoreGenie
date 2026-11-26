import { useEffect, useRef } from "react";
import paths from "@/utils/paths";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ProviderPrivacy from "@/components/ProviderPrivacy";

import Workspace from "@/models/workspace";
import System from "@/models/system";
import showToast from "@/utils/toast";

export default function DataHandling({ setHeader, setForwardBtn, setBackBtn }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const saving = useRef(false);
  const TITLE = t("onboarding.data.title");
  const DESCRIPTION = t("onboarding.data.description");

  useEffect(() => {
    setHeader({ title: TITLE, description: DESCRIPTION });
    setForwardBtn({ showing: true, disabled: false, onClick: handleForward });
    setBackBtn({ showing: false, disabled: false, onClick: handleBack });
  }, []);

  async function handleForward() {
    if (saving.current) return;
    saving.current = true;
    setForwardBtn({ showing: true, disabled: true, onClick: handleForward });
    try {
      const workspaces = await Workspace.all({ throwOnError: true });
      if (!workspaces.length) {
        const { workspace, message } = await Workspace.new({
          name: t("new-workspace.placeholder"),
        });
        if (!workspace)
          throw new Error(message || t("onboarding.data.finishError"));
      }
      if (!(await System.markOnboardingComplete()))
        throw new Error(t("onboarding.data.finishError"));
      navigate(paths.home(), { replace: true });
    } catch (error) {
      showToast(error.message, "error");
      saving.current = false;
      setForwardBtn({ showing: true, disabled: false, onClick: handleForward });
    }
  }

  function handleBack() {
    navigate(paths.onboarding.userSetup());
  }

  return (
    <div className="w-full flex items-center justify-center flex-col gap-y-6">
      <ProviderPrivacy />
      <p className="text-theme-text-secondary text-sm font-medium py-1">
        {t("onboarding.data.settingsHint")}
      </p>
    </div>
  );
}
