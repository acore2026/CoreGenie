import { Robot } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export default function ChatModeSelection() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <p className="block input-label">{t("chat.mode.title")}</p>
      <input type="hidden" name="chatMode" value="automatic" />
      <div className="flex min-h-12 items-start gap-3 border-y border-theme-sidebar-border py-3">
        <Robot
          size={20}
          weight="fill"
          className="mt-0.5 shrink-0 text-cyan-300 light:text-cyan-700"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-theme-text-primary">
            {t("chat.mode.automatic.title")}
          </p>
          <p className="mt-1 text-xs leading-5 text-theme-text-secondary">
            {t("chat.mode.automatic.description")}
          </p>
        </div>
      </div>
    </div>
  );
}
