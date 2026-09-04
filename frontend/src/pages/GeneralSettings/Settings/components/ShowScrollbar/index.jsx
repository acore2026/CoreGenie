import React, { useState } from "react";
import Appearance from "@/models/appearance";
import { useTranslation } from "react-i18next";
import Toggle from "@/components/lib/Toggle";

export default function ShowScrollbar() {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [showScrollbar, setShowScrollbar] = useState(() =>
    Appearance.get("showScrollbar")
  );

  const handleChange = async (checked) => {
    setShowScrollbar(checked);
    setSaving(true);
    try {
      Appearance.updateSettings({ showScrollbar: checked });
    } catch (error) {
      console.error("Failed to update appearance settings:", error);
      setShowScrollbar(!checked);
    }
    setSaving(false);
  };

  return (
    <div className="my-4">
      <Toggle
        size="md"
        variant="horizontal"
        enabled={showScrollbar}
        onChange={handleChange}
        disabled={saving}
        label={t("customization.items.show-scrollbar.title")}
        description={t("customization.items.show-scrollbar.description")}
      />
    </div>
  );
}
