import useLoginMode from "@/hooks/useLoginMode";
import usePfp from "@/hooks/usePfp";
import useUser from "@/hooks/useUser";
import paths from "@/utils/paths";
import { userFromStorage } from "@/utils/request";
import {
  CaretDown,
  GearSix,
  Person,
  SignOut,
  UsersThree,
  UserCircle,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import AccountModal from "../AccountModal";
import {
  AUTH_TIMESTAMP,
  AUTH_TOKEN,
  AUTH_USER,
  LAST_VISITED_WORKSPACE,
  USER_PROMPT_INPUT_MAP,
} from "@/utils/constants";
import { useTranslation } from "react-i18next";
import useAdminView from "@/hooks/useAdminView";

export default function UserButton({
  inline = false,
  menuAlign = "right",
  menuPlacement = "bottom",
  showName = false,
}) {
  const { t } = useTranslation();
  const mode = useLoginMode();
  const { user } = useUser();
  const { adminView, setAdminView, canUseAdminView } = useAdminView(user);
  const menuRef = useRef();
  const buttonRef = useRef();
  const [showMenu, setShowMenu] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);

  const handleClose = (event) => {
    if (
      menuRef.current &&
      !menuRef.current.contains(event.target) &&
      !buttonRef.current.contains(event.target)
    ) {
      setShowMenu(false);
    }
  };

  const handleOpenAccountModal = () => {
    setShowAccountSettings(true);
    setShowMenu(false);
  };

  useEffect(() => {
    if (!showMenu) return;
    menuRef.current
      ?.querySelector('[role="menuitem"], [role="menuitemcheckbox"]')
      ?.focus();
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      setShowMenu(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", handleClose);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClose);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showMenu]);

  if (mode === null && !inline) return null;
  const canManage = !user || user.role !== "default";
  return (
    <div
      className={
        inline
          ? `relative z-40 h-fit min-w-0 ${showName ? "w-full" : ""}`
          : "absolute top-3 right-4 md:top-9 md:right-10 w-fit h-fit z-40"
      }
    >
      <button
        ref={buttonRef}
        onClick={() => setShowMenu(!showMenu)}
        type="button"
        aria-label={t("profile_settings.account")}
        aria-haspopup="menu"
        aria-expanded={showMenu}
        className={
          inline
            ? `flex h-9 ${showName ? "w-full gap-2 px-2 text-left" : "w-9 justify-center"} items-center rounded-md border border-transparent text-sm font-medium text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary`
            : "flex h-[35px] w-[35px] items-center justify-center rounded-full border border-transparent bg-theme-action-menu-bg p-2 text-base font-semibold uppercase text-white transition-colors duration-150 hover:bg-theme-action-menu-item-hover"
        }
      >
        {mode === "multi" ? (
          <UserDisplay compact={inline} />
        ) : (
          <Person size={17} className="shrink-0" />
        )}
        {showName && (
          <>
            <span className="truncate">
              {user?.username || t("profile_settings.account")}
            </span>
            <CaretDown size={12} className="ml-auto shrink-0" />
          </>
        )}
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = [
              ...event.currentTarget.querySelectorAll(
                '[role="menuitem"], [role="menuitemcheckbox"]'
              ),
            ];
            const index = items.indexOf(document.activeElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[next]?.focus();
          }}
          className={`dsh-menu absolute flex min-w-[224px] items-center justify-center ${
            menuPlacement === "top" ? "bottom-10" : "top-10"
          } ${menuAlign === "left" ? "left-0" : "right-0"}`}
        >
          <div className="flex w-full flex-col">
            {mode === "multi" && !!user && (
              <button
                onClick={handleOpenAccountModal}
                type="button"
                role="menuitem"
                className="dsh-menu-item whitespace-nowrap"
              >
                <UserCircle size={17} />
                {t("profile_settings.account")}
              </button>
            )}
            {canManage && (
              <Link
                to={paths.settings.interface()}
                role="menuitem"
                onClick={() => setShowMenu(false)}
                className="dsh-menu-item whitespace-nowrap"
              >
                <GearSix size={17} />
                {t("profile_settings.admin")}
              </Link>
            )}
            {mode === "multi" && canUseAdminView && (
              <button
                onClick={() => setAdminView(!adminView)}
                type="button"
                role="menuitemcheckbox"
                aria-checked={adminView}
                className="dsh-menu-item min-h-11 whitespace-nowrap"
              >
                <UsersThree size={17} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {t("profile_settings.admin_view")}
                  </span>
                  <span className="block text-[11px] text-theme-text-secondary">
                    {t("profile_settings.admin_view_description")}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${adminView ? "bg-theme-button-primary" : "bg-theme-sidebar-subitem-hover"}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${adminView ? "translate-x-[18px]" : "translate-x-0.5"}`}
                  />
                </span>
              </button>
            )}
            <button
              onClick={() => {
                window.localStorage.removeItem(AUTH_USER);
                window.localStorage.removeItem(AUTH_TOKEN);
                window.localStorage.removeItem(AUTH_TIMESTAMP);
                window.localStorage.removeItem(LAST_VISITED_WORKSPACE);
                window.localStorage.removeItem(USER_PROMPT_INPUT_MAP);
                window.location.replace(paths.home());
              }}
              type="button"
              role="menuitem"
              className="dsh-menu-item whitespace-nowrap"
            >
              <SignOut size={17} />
              {t("profile_settings.signout")}
            </button>
          </div>
        </div>
      )}
      {user && showAccountSettings && (
        <AccountModal
          user={user}
          hideModal={() => setShowAccountSettings(false)}
        />
      )}
    </div>
  );
}

function UserDisplay({ compact = false }) {
  const { pfp } = usePfp();
  const user = userFromStorage();

  if (pfp) {
    return (
      <div
        className={`${compact ? "h-7 w-7 rounded-md" : "h-[35px] w-[35px] rounded-full"} flex-shrink-0 overflow-hidden border border-transparent bg-gray-100 transition-opacity duration-150 hover:opacity-80`}
      >
        <img src={pfp} alt="用户头像" className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-theme-sidebar-subitem-selected text-xs font-semibold text-theme-text-primary">
      {user?.username?.slice(0, 2) || "AA"}
    </span>
  );
}
