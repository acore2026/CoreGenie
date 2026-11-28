import { Sparkle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import paths from "@/utils/paths";
import FeatureLink from "./FeatureLink";

export default function SkillsLink({ iconOnly = false }) {
  const { t } = useTranslation();
  return (
    <FeatureLink
      to={paths.personalSkills()}
      label={t("personal_skills.title")}
      icon={Sparkle}
      iconOnly={iconOnly}
      iconClassName="text-cyan-400 light:text-cyan-700"
    />
  );
}
