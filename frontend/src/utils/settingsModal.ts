import paths from "@/utils/paths";
import { SETTINGS_RETURN_PATH } from "@/utils/constants";

export function isSettingsModalPath(pathname = "") {
  return (
    pathname.startsWith("/settings/") ||
    /^\/workspace\/[^/]+\/settings\/[^/]+$/.test(pathname)
  );
}

export function getSettingsReturnPath() {
  const returnPath = sessionStorage.getItem(SETTINGS_RETURN_PATH);
  if (
    returnPath === "/" ||
    /^\/workspace\/[^/]+(?:\/t\/[^/]+)?(?:[?#].*)?$/.test(returnPath || "")
  )
    return returnPath;

  return paths.home();
}
