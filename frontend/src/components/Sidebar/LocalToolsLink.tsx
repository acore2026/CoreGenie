import { Wrench } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import paths from "@/utils/paths";
import FeatureLink from "./FeatureLink";

export default function LocalToolsLink({ iconOnly = false }) {
  const { t } = useTranslation();
  return (
    <FeatureLink
      to={paths.tools()}
      label={t("local_tools.nav")}
      icon={Wrench}
      iconOnly={iconOnly}
      iconClassName="text-amber-400 light:text-amber-700"
    />
  );
}
