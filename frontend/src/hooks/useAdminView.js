import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_VIEW_CHANGED_EVENT,
  canUseAdminView,
  readAdminView,
  writeAdminView,
} from "@/utils/adminView";

export default function useAdminView(user) {
  const eligible = canUseAdminView(user);
  const userId = user?.id;
  const [adminView, setAdminViewState] = useState(() =>
    eligible ? readAdminView(userId) : false
  );

  useEffect(() => {
    setAdminViewState(eligible ? readAdminView(userId) : false);
  }, [eligible, userId]);

  useEffect(() => {
    if (!eligible) return;
    const handleChange = (event) => {
      if (String(event.detail?.userId) !== String(userId)) return;
      setAdminViewState(Boolean(event.detail?.enabled));
    };
    const handleStorage = (event) => {
      if (!event.key?.endsWith(`:${userId}`)) return;
      setAdminViewState(readAdminView(userId));
    };
    window.addEventListener(ADMIN_VIEW_CHANGED_EVENT, handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(ADMIN_VIEW_CHANGED_EVENT, handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [eligible, userId]);

  const setAdminView = useCallback(
    (enabled) => {
      if (!eligible) return;
      writeAdminView(userId, enabled);
      setAdminViewState(enabled);
    },
    [eligible, userId]
  );

  return { adminView, setAdminView, canUseAdminView: eligible };
}
