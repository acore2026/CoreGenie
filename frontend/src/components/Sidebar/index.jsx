import React, { useEffect, useRef, useState } from "react";
import { List, MagnifyingGlass, X } from "@phosphor-icons/react";
import NewWorkspaceModal, {
  useNewWorkspaceModal,
} from "../Modals/NewWorkspace";
import ActiveWorkspaces from "./ActiveWorkspaces";
import useLogo from "@/hooks/useLogo";
import Footer from "../Footer";
import { Link, useLocation } from "react-router-dom";
import paths from "@/utils/paths";
import { useSidebarToggle, ToggleSidebarButton } from "./SidebarToggle";
import SearchBox, { CreateMenuButton } from "./SearchBox";
import { Tooltip } from "react-tooltip";
import { createPortal } from "react-dom";
import HelpShortcut from "./HelpShortcut";
import { CLOSE_MOBILE_SIDEBAR_EVENT } from "./events";
import { useTranslation } from "react-i18next";
import { ModalPortalContext } from "@/components/ModalWrapper";
import UserButton from "@/components/UserMenu/UserButton";

const navControl =
  "flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm text-theme-text-primary transition-colors hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary";

export default function Sidebar() {
  const { logo, isCustomLogo } = useLogo();
  const { t } = useTranslation();
  const sidebarRef = useRef(null);
  const { showSidebar, setShowSidebar, canToggleSidebar } = useSidebarToggle();
  const {
    showing: showingNewWsModal,
    showModal: showNewWsModal,
    hideModal: hideNewWsModal,
  } = useNewWorkspaceModal();
  const expanded = showSidebar || !canToggleSidebar;

  function openSearch() {
    setShowSidebar(true);
    requestAnimationFrame(() =>
      sidebarRef.current?.querySelector('input[type="search"]')?.focus()
    );
  }

  return (
    <>
      <aside
        aria-label={t("workbench_nav.label")}
        data-sidebar-expanded={expanded}
        style={{ width: expanded ? "288px" : "56px" }}
        className="relative flex h-full shrink-0 flex-col border-r border-theme-sidebar-border bg-theme-bg-chat"
      >
        <div
          className={`shrink-0 ${expanded ? "flex h-16 items-center gap-2 px-3" : "flex flex-col items-center gap-1 py-3"}`}
        >
          {expanded && (
            <>
              <Link
                to={paths.home()}
                aria-label={t("workbench_nav.home")}
                className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
              >
                <SidebarBrand logo={logo} isCustomLogo={isCustomLogo} />
              </Link>
            </>
          )}
          {!expanded && (
            <Link to={paths.home()} aria-label={t("workbench_nav.home")}>
              <img src="/coregenie-mark.svg" alt="" className="h-9 w-9" />
            </Link>
          )}
          {canToggleSidebar && (
            <ToggleSidebarButton
              showSidebar={expanded}
              setShowSidebar={setShowSidebar}
            />
          )}
        </div>
        <div
          ref={sidebarRef}
          id="workspace-navigation"
          hidden={!expanded}
          className="min-h-0 flex-1"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="px-3 pb-4">
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <SearchBox />
                </div>
                <CreateMenuButton showNewWsModal={showNewWsModal} />
              </div>
            </div>
            <div className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-theme-sidebar-border px-3 py-3">
              <ActiveWorkspaces />
            </div>
            <div className="shrink-0 border-t border-theme-sidebar-border px-3 pb-2 pt-3">
              <div className="flex items-center gap-1 pb-2">
                <div className="min-w-0 flex-1">
                  <UserButton
                    inline
                    menuAlign="left"
                    menuPlacement="top"
                    showName
                  />
                </div>
                <HelpShortcut iconOnly />
              </div>
              <Footer />
            </div>
          </div>
        </div>
        {!expanded && (
          <div className="flex flex-1 flex-col items-center gap-2 pb-3">
            <CreateMenuButton showNewWsModal={showNewWsModal} />
            <button
              type="button"
              onClick={openSearch}
              aria-label={t("workbench_nav.search")}
              title={t("workbench_nav.search")}
              className={`${navControl} w-10 justify-center !px-0`}
            >
              <MagnifyingGlass size={20} />
            </button>
            <div className="mt-auto flex flex-col items-center gap-2">
              <UserButton inline menuAlign="left" menuPlacement="top" />
              <HelpShortcut iconOnly />
            </div>
          </div>
        )}
        {showingNewWsModal && <NewWorkspaceModal hideModal={hideNewWsModal} />}
      </aside>
      <WorkspaceAndThreadTooltips />
    </>
  );
}

export function SidebarMobileHeader() {
  const { logo, isCustomLogo } = useLogo();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [dialog, setDialog] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const {
    showing: showingNewWsModal,
    showModal: showNewWsModal,
    hideModal: hideNewWsModal,
  } = useNewWorkspaceModal();

  useEffect(() => {
    if (!dialog) return;
    if (showSidebar && !dialog.open) dialog.showModal();
    if (!showSidebar && dialog.open) dialog.close();
  }, [showSidebar, dialog]);

  useEffect(() => {
    setShowSidebar(false);
  }, [pathname]);

  useEffect(() => {
    const closeSidebar = () => setShowSidebar(false);
    window.addEventListener(CLOSE_MOBILE_SIDEBAR_EVENT, closeSidebar);
    return () =>
      window.removeEventListener(CLOSE_MOBILE_SIDEBAR_EVENT, closeSidebar);
  }, []);

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-10 flex h-16 items-center justify-between border-b border-theme-sidebar-border bg-theme-bg-chat px-4 py-2 text-theme-text-primary">
        <div className="flex items-center">
          <button
            type="button"
            aria-label={t("workbench_nav.expand")}
            aria-expanded={showSidebar}
            aria-controls="mobile-workspace-navigation"
            onClick={() => setShowSidebar(true)}
            className={`${navControl} w-10 justify-center !px-0`}
          >
            <List className="h-6 w-6" />
          </button>
          <HelpShortcut iconOnly />
        </div>
        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center justify-center">
          <SidebarBrand logo={logo} isCustomLogo={isCustomLogo} compact />
        </div>
        <span className="h-10 w-10" aria-hidden="true" />
      </div>
      <dialog
        ref={setDialog}
        id="mobile-workspace-navigation"
        aria-label={t("workbench_nav.label")}
        onClose={() => setShowSidebar(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setShowSidebar(false);
        }}
        className="fixed inset-y-0 left-0 m-0 h-[100dvh] max-h-none w-[min(320px,88vw)] max-w-none !items-stretch !justify-start !overflow-x-hidden border-0 border-r border-theme-sidebar-border bg-theme-bg-chat p-0 text-theme-text-primary backdrop:bg-black/40"
      >
        <ModalPortalContext.Provider value={dialog}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-16 shrink-0 items-center gap-2 px-3">
              <Link
                to={paths.home()}
                onClick={() => setShowSidebar(false)}
                className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
              >
                <SidebarBrand logo={logo} isCustomLogo={isCustomLogo} />
              </Link>
              <button
                type="button"
                onClick={() => setShowSidebar(false)}
                aria-label={t("workbench_nav.close")}
                className={`${navControl} w-10 justify-center !px-0`}
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-3 pb-4">
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <SearchBox />
                </div>
                <CreateMenuButton showNewWsModal={showNewWsModal} />
              </div>
            </div>
            <div className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-theme-sidebar-border px-3 py-3">
              <ActiveWorkspaces />
            </div>
            <div className="shrink-0 border-t border-theme-sidebar-border px-3 pb-4 pt-3">
              <div className="flex items-center gap-1 pb-2">
                <div className="min-w-0 flex-1">
                  <UserButton
                    inline
                    menuAlign="left"
                    menuPlacement="top"
                    showName
                  />
                </div>
                <HelpShortcut iconOnly />
              </div>
              <Footer />
            </div>
          </div>
          {showingNewWsModal && (
            <NewWorkspaceModal hideModal={hideNewWsModal} />
          )}
        </ModalPortalContext.Provider>
      </dialog>
      <WorkspaceAndThreadTooltips />
    </>
  );
}

function SidebarBrand({ logo, isCustomLogo, compact = false }) {
  if (isCustomLogo) {
    return (
      <img
        src={logo}
        alt="品牌标志"
        className={`${compact ? "h-8" : "h-9"} max-w-[188px] object-contain`}
      />
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <img
        src="/coregenie-mark.svg"
        alt=""
        className={`${compact ? "h-8 w-8" : "h-9 w-9"} shrink-0`}
      />
      <span
        className={`${compact ? "text-xl" : "text-[22px]"} truncate font-bold leading-none tracking-[-0.04em] text-theme-text-primary`}
      >
        Core<span className="text-sky-400 light:text-sky-600">Genie</span>
      </span>
    </span>
  );
}

function WorkspaceAndThreadTooltips() {
  return createPortal(
    <React.Fragment>
      <Tooltip
        id="workspace-name"
        place="right"
        delayShow={800}
        style={{ zIndex: 1000 }}
        className="tooltip !text-xs z-99"
      />
      <Tooltip
        id="workspace-thread-name"
        place="right"
        delayShow={800}
        style={{ zIndex: 1000 }}
        className="tooltip !text-xs z-99"
      />
      <Tooltip
        id="gear-workspace"
        place="top"
        delayShow={300}
        positionStrategy="fixed"
        style={{ zIndex: 1000 }}
        className="tooltip !z-[1000] !text-xs"
      />
    </React.Fragment>,
    document.body
  );
}
