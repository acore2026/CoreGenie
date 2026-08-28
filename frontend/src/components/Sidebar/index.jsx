import React, { useEffect, useRef, useState } from "react";
import { List } from "@phosphor-icons/react";
import NewWorkspaceModal, {
  useNewWorkspaceModal,
} from "../Modals/NewWorkspace";
import ActiveWorkspaces from "./ActiveWorkspaces";
import useLogo from "@/hooks/useLogo";
import Footer from "../Footer";
import { Link } from "react-router-dom";
import paths from "@/utils/paths";
import { useSidebarToggle, ToggleSidebarButton } from "./SidebarToggle";
import SearchBox from "./SearchBox";
import { Tooltip } from "react-tooltip";
import { createPortal } from "react-dom";
import HelpShortcut from "./HelpShortcut";

export default function Sidebar() {
  const { logo } = useLogo();
  const sidebarRef = useRef(null);
  const { showSidebar, setShowSidebar, canToggleSidebar } = useSidebarToggle();
  const {
    showing: showingNewWsModal,
    showModal: showNewWsModal,
    hideModal: hideNewWsModal,
  } = useNewWorkspaceModal();

  return (
    <>
      <div
        style={{
          width: showSidebar ? "292px" : "0px",
          paddingLeft: showSidebar ? "0px" : "16px",
        }}
        className="relative transition-all duration-500"
      >
        {canToggleSidebar && (
          <ToggleSidebarButton
            showSidebar={showSidebar}
            setShowSidebar={setShowSidebar}
          />
        )}
        <div className="overflow-hidden h-full">
          <div className="flex shrink-0 w-full justify-center my-[18px]">
            <div className="flex w-[250px] min-w-[250px]">
              <Link to={paths.home()} aria-label="Home">
                <img
                  src={logo}
                  alt="品牌标志"
                  className={`rounded max-h-[32px] object-contain transition-opacity duration-500 ${showSidebar ? "opacity-100" : "opacity-0"}`}
                />
              </Link>
            </div>
          </div>
          <div
            ref={sidebarRef}
            className="relative m-[16px] rounded-[16px] bg-theme-bg-sidebar light:bg-slate-200 border-[2px] border-theme-sidebar-border light:border-none min-w-[250px] p-[10px] h-[calc(100%-84px)]"
          >
            <div className="flex flex-col h-full overflow-hidden">
              <div className="flex-grow flex flex-col min-w-[235px] min-h-0">
                <div className="relative h-[calc(100%-60px)] flex flex-col w-full justify-between pt-[10px] overflow-y-scroll no-scroll">
                  <div className="flex flex-col gap-y-[14px]">
                    <SearchBox showNewWsModal={showNewWsModal} />
                    <ActiveWorkspaces />
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 pb-3 rounded-b-[16px] bg-theme-bg-sidebar light:bg-slate-200 bg-opacity-80 backdrop-filter backdrop-blur-md z-10">
                  <HelpShortcut />
                  <Footer />
                </div>
              </div>
            </div>
          </div>
        </div>
        {showingNewWsModal && <NewWorkspaceModal hideModal={hideNewWsModal} />}
      </div>
      <WorkspaceAndThreadTooltips />
    </>
  );
}

export function SidebarMobileHeader() {
  const { logo } = useLogo();
  const sidebarRef = useRef(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showBgOverlay, setShowBgOverlay] = useState(false);
  const {
    showing: showingNewWsModal,
    showModal: showNewWsModal,
    hideModal: hideNewWsModal,
  } = useNewWorkspaceModal();

  useEffect(() => {
    // Darkens the rest of the screen
    // when sidebar is open.
    function handleBg() {
      if (showSidebar) {
        setTimeout(() => {
          setShowBgOverlay(true);
        }, 300);
      } else {
        setShowBgOverlay(false);
      }
    }
    handleBg();
  }, [showSidebar]);

  return (
    <>
      <div
        aria-label="Show sidebar"
        className="fixed top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-2 bg-theme-bg-sidebar light:bg-white text-slate-200 shadow-lg h-16"
      >
        <div className="flex items-center">
          <button
            onClick={() => setShowSidebar(true)}
            className="rounded-md p-2 flex items-center justify-center text-theme-text-secondary"
          >
            <List className="h-6 w-6" />
          </button>
          <HelpShortcut iconOnly />
        </div>
        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center justify-center">
          <img
            src={logo}
            alt="品牌标志"
            className="block mx-auto h-8 w-auto"
            style={{ maxHeight: "40px", objectFit: "contain" }}
          />
        </div>
        <span className="h-10 w-10" aria-hidden="true" />
      </div>
      <div
        style={{
          transform: showSidebar ? `translateX(0vw)` : `translateX(-100vw)`,
        }}
        className={`z-99 fixed top-0 left-0 transition-all duration-500 w-[100vw] h-[100vh]`}
      >
        <div
          className={`${
            showBgOverlay
              ? "transition-all opacity-1"
              : "transition-none opacity-0"
          }  duration-500 fixed top-0 left-0 bg-theme-bg-secondary bg-opacity-75 w-screen h-screen`}
          onClick={() => setShowSidebar(false)}
        />
        <div
          ref={sidebarRef}
          className="relative h-[100vh] fixed top-0 left-0  rounded-r-[26px] bg-theme-bg-sidebar w-[80%] p-[18px] "
        >
          <div className="w-full h-full flex flex-col overflow-x-hidden items-between">
            {/* Header Information */}
            <div className="flex w-full items-center justify-between gap-x-4">
              <div className="flex shrink-1 w-fit items-center justify-start">
                <img
                  src={logo}
                  alt="品牌标志"
                  className="rounded w-full max-h-[48px]"
                  style={{ objectFit: "contain" }}
                />
              </div>
            </div>

            {/* Primary Body */}
            <div className="h-full flex flex-col w-full justify-between pt-4 ">
              <div className="h-auto md:sidebar-items">
                <div className=" flex flex-col gap-y-4 overflow-y-scroll no-scroll pb-[60px]">
                  <SearchBox showNewWsModal={showNewWsModal} />
                  <ActiveWorkspaces />
                </div>
              </div>
              <div className="z-99 absolute bottom-0 left-0 right-0 pt-2 pb-6 rounded-br-[26px] bg-theme-bg-sidebar bg-opacity-80 backdrop-filter backdrop-blur-md">
                <HelpShortcut />
                <Footer />
              </div>
            </div>
          </div>
        </div>
        {showingNewWsModal && <NewWorkspaceModal hideModal={hideNewWsModal} />}
      </div>
    </>
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
        id="upload-workspace"
        place="top"
        delayShow={300}
        positionStrategy="fixed"
        style={{ zIndex: 1000 }}
        className="tooltip !z-[1000] !text-xs"
      />
      <Tooltip
        id="invite-workspace"
        place="top"
        delayShow={300}
        positionStrategy="fixed"
        style={{ zIndex: 1000 }}
        className="tooltip !z-[1000] !text-xs"
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
