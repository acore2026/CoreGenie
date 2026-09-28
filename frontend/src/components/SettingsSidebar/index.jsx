import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import paths from "@/utils/paths";
import useLogo from "@/hooks/useLogo";
import {
  ArrowLeft,
  X,
  List,
  Flask,
  Gear,
  UserCircleGear,
  PencilSimpleLine,
  Nut,
  Toolbox,
  Plugs,
} from "@phosphor-icons/react";
import AgentIcon from "@/media/animations/agent-static.png";
import useUser from "@/hooks/useUser";
import { isMobile } from "react-device-detect";
import Footer from "../Footer";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import showToast from "@/utils/toast";
import System from "@/models/system";
import Option from "./MenuOption";
import { CanViewChatHistoryProvider } from "../CanViewChatHistory";
import useAppVersion from "@/hooks/useAppVersion";
import {
  SettingsModalBackdrop,
  useSettingsModal,
} from "@/components/SettingsModal";
import { getSettingsReturnPath } from "@/utils/settingsModal";

export default function SettingsSidebar() {
  const { t } = useTranslation();
  const { logo } = useLogo();
  const { user } = useUser();
  const navigate = useNavigate();
  const sidebarRef = useRef(null);
  const [closeTarget, setCloseTarget] = useState(null);
  useLayoutEffect(() => {
    if (!isMobile) setCloseTarget(sidebarRef.current?.nextElementSibling);
  }, []);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showBgOverlay, setShowBgOverlay] = useState(false);
  const returnPath = getSettingsReturnPath();
  const closeSettings = useCallback(
    () => navigate(returnPath, { replace: true }),
    [navigate, returnPath]
  );

  useSettingsModal({
    anchorRef: sidebarRef,
    onDismiss: closeSettings,
    labelledBy: "system-settings-title",
  });

  useEffect(() => {
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

  if (isMobile) {
    return (
      <>
        <SettingsModalBackdrop onDismiss={closeSettings} />
        <div
          ref={sidebarRef}
          className="fixed top-0 left-0 right-0 z-10 flex justify-between items-center px-4 py-2 bg-theme-bg-sidebar light:bg-white text-theme-text-secondary shadow-lg h-16"
        >
          <Link
            to={returnPath}
            replace
            data-settings-close
            aria-label={t("settings.back-to-chat")}
            title={t("settings.back-to-chat")}
            className="rounded-lg p-2 flex items-center justify-center text-theme-text-secondary hover:text-white hover:bg-theme-action-menu-item-hover hover:light:text-theme-text-primary transition-colors"
          >
            <ArrowLeft className="h-6 w-6" weight="bold" />
          </Link>
          <div className="flex items-center justify-center flex-grow">
            <img
              src={logo}
              alt="品牌标志"
              className="block mx-auto h-8 w-auto"
              style={{ maxHeight: "40px", objectFit: "contain" }}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowSidebar(true)}
            aria-label={t("settings.title")}
            className="rounded-lg p-2 flex items-center justify-center text-theme-text-secondary hover:text-white hover:bg-theme-action-menu-item-hover hover:light:text-theme-text-primary transition-colors"
          >
            <List className="h-6 w-6" />
          </button>
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
            className="h-[100vh] fixed top-0 left-0 rounded-r-[26px] bg-theme-bg-sidebar w-[80%] p-[18px]"
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
                <div className="flex gap-x-2 items-center text-slate-500 shrink-0">
                  <Link
                    to={returnPath}
                    aria-label={t("settings.back-to-chat")}
                    title={t("settings.back-to-chat")}
                    className="transition-all duration-300 p-2 rounded-full text-white bg-theme-action-menu-bg hover:bg-theme-action-menu-item-hover hover:border-slate-100 hover:border-opacity-50 border-transparent border"
                  >
                    <ArrowLeft className="h-4 w-4" weight="bold" />
                  </Link>
                </div>
              </div>

              {/* Primary Body */}
              <div className="h-full flex flex-col w-full justify-between pt-4 overflow-y-scroll no-scroll">
                <div className="h-auto md:sidebar-items">
                  <div className="flex flex-col gap-y-4 pb-[60px] overflow-y-scroll no-scroll">
                    <SidebarOptions user={user} t={t} />
                    <div className="h-[1.5px] bg-[#3D4147] mx-3 mt-[14px]" />
                    <SupportEmail />
                    <Link
                      to={paths.help()}
                      className="text-theme-text-secondary hover:text-white hover:light:text-theme-text-primary text-xs leading-[18px] mx-3"
                    >
                      {t("help.navigation")}
                    </Link>
                    <Link
                      hidden={
                        user?.hasOwnProperty("role") && user.role !== "admin"
                      }
                      to={paths.settings.privacy()}
                      className="text-theme-text-secondary hover:text-white text-xs leading-[18px] mx-3"
                    >
                      {t("settings.privacy")}
                    </Link>
                    <AppVersion />
                  </div>
                </div>
              </div>
              <div className="absolute bottom-2 left-0 right-0 pt-2 bg-theme-bg-sidebar bg-opacity-80 backdrop-filter backdrop-blur-md">
                <Footer />
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SettingsModalBackdrop onDismiss={closeSettings} />
      <div ref={sidebarRef} className="system-settings-sidebar">
        <div className="flex h-14 shrink-0 items-center justify-between px-5">
          <h1
            id="system-settings-title"
            className="text-base font-semibold text-theme-text-primary"
          >
            {t("settings.title")}
          </h1>
          {closeTarget &&
            createPortal(
              <Link
                to={returnPath}
                replace
                data-settings-close
                aria-label={t("settings.back-to-chat")}
                title={t("settings.back-to-chat")}
                className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-theme-bg-secondary text-theme-text-secondary transition-colors duration-150 hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
              >
                <X size={16} weight="bold" />
              </Link>,
              closeTarget
            )}
        </div>
        <nav
          aria-label={t("settings.title")}
          className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-4"
        >
          <div className="flex flex-col gap-1">
            <SidebarOptions user={user} t={t} />
          </div>
        </nav>
        <div className="shrink-0 border-t border-theme-sidebar-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-theme-text-secondary">
            <SupportEmail />
            <Link
              to={paths.help()}
              className="transition-colors hover:text-theme-text-primary"
            >
              {t("help.navigation")}
            </Link>
            <Link
              hidden={user?.hasOwnProperty("role") && user.role !== "admin"}
              to={paths.settings.privacy()}
              className="transition-colors hover:text-theme-text-primary"
            >
              {t("settings.privacy")}
            </Link>
          </div>
          <div className="mt-2 text-[11px] text-theme-text-secondary opacity-70">
            <AppVersion />
          </div>
        </div>
      </div>
    </>
  );
}

function SupportEmail() {
  const [supportEmail, setSupportEmail] = useState(paths.mailToMintplex());
  const { t } = useTranslation();

  useEffect(() => {
    const fetchSupportEmail = async () => {
      const supportEmail = await System.fetchSupportEmail();
      setSupportEmail(
        supportEmail?.email
          ? `mailto:${supportEmail.email}`
          : paths.mailToMintplex()
      );
    };
    fetchSupportEmail();
  }, []);

  return (
    <Link
      to={supportEmail}
      className="transition-colors hover:text-theme-text-primary"
    >
      {t("settings.contact")}
    </Link>
  );
}

const SidebarOptions = ({ user = null, t }) => (
  <CanViewChatHistoryProvider>
    {({ viewable: canViewChatHistory }) => (
      <>
        <Option
          btnText={t("settings.ai-providers")}
          icon={<Gear className="h-5 w-5 flex-shrink-0" />}
          user={user}
          childOptions={[
            {
              btnText: t("settings.llm"),
              href: paths.settings.llmPreference(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.vector-database"),
              href: paths.settings.vectorDatabase(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.embedder"),
              href: paths.settings.embedder.modelPreference(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.text-splitting"),
              href: paths.settings.embedder.chunkingPreference(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.voice-speech"),
              href: paths.settings.audioPreference(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.transcription"),
              href: paths.settings.transcriptionPreference(),
              flex: true,
              roles: ["admin"],
            },
          ]}
        />
        <Option
          btnText={t("settings.admin")}
          icon={<UserCircleGear className="h-5 w-5 flex-shrink-0" />}
          user={user}
          childOptions={[
            {
              btnText: t("settings.users"),
              href: paths.settings.users(),
              roles: ["admin", "manager"],
            },
            {
              btnText: t("settings.workspaces"),
              href: paths.settings.workspaces(),
              roles: ["admin", "manager"],
            },
            {
              btnText: t("settings.global-knowledge"),
              href: paths.settings.globalKnowledge(),
              roles: ["admin"],
            },
            {
              hidden: !canViewChatHistory,
              btnText: t("settings.workspace-chats"),
              href: paths.settings.chats(),
              flex: true,
              roles: ["admin", "manager"],
            },
            {
              btnText: t("settings.invites"),
              href: paths.settings.invites(),
              roles: ["admin", "manager"],
            },
          ]}
        />
        <Option
          btnText={t("settings.agents")}
          icon={
            <img
              src={AgentIcon}
              alt="Agent"
              className="h-5 w-5 flex-shrink-0 light:invert"
            />
          }
          user={user}
          href={paths.settings.agents()}
          childOptions={[
            {
              btnText: t("settings.agents"),
              href: paths.settings.agents(),
              exact: true,
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.agent-prompts"),
              href: paths.settings.agentPrompts(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.agent-feedback"),
              href: paths.settings.agentFeedback(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.predefined-agent-skills"),
              href: paths.settings.predefinedAgentSkills(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("quick_tasks.title"),
              href: paths.settings.quickTasks(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.agent-tools"),
              href: paths.settings.agentTools(),
              flex: true,
              roles: ["admin"],
            },
          ]}
        />
        <Option
          btnText={t("settings.customization")}
          icon={<PencilSimpleLine className="h-5 w-5 flex-shrink-0" />}
          user={user}
          childOptions={[
            {
              btnText: t("settings.interface"),
              href: paths.settings.interface(),
              flex: true,
              roles: ["admin", "manager"],
            },
            {
              btnText: t("settings.branding"),
              href: paths.settings.branding(),
              flex: true,
              roles: ["admin", "manager"],
            },
            {
              btnText: t("settings.chat"),
              href: paths.settings.chat(),
              flex: true,
              roles: ["admin", "manager"],
            },
          ]}
        />
        <Option
          btnText={t("settings.channels")}
          icon={<Plugs className="h-5 w-5 flex-shrink-0" />}
          user={user}
          childOptions={[
            {
              btnText: t("settings.available-channels.telegram"),
              href: paths.settings.telegram(),
              flex: true,
              hidden: !!user,
            },
          ]}
        />
        <Option
          btnText={t("settings.tools")}
          icon={<Toolbox className="h-5 w-5 flex-shrink-0" />}
          user={user}
          childOptions={[
            {
              hidden: !canViewChatHistory,
              btnText: t("settings.embeds"),
              href: paths.settings.embedChatWidgets(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.event-logs"),
              href: paths.settings.logs(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.scheduled-jobs"),
              href: paths.settings.scheduledJobs(),
              flex: true,
              hidden: !!user,
            },
            {
              btnText: t("settings.api-keys"),
              href: paths.settings.apiKeys(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.system-prompt-variables"),
              href: paths.settings.systemPromptVariables(),
              flex: true,
              roles: ["admin"],
            },
            {
              btnText: t("settings.browser-extension"),
              href: paths.settings.browserExtension(),
              flex: true,
              roles: ["admin", "manager"],
            },
          ]}
        />
        <Option
          btnText={t("settings.security")}
          icon={<Nut className="h-5 w-5 flex-shrink-0" />}
          href={paths.settings.security()}
          user={user}
          flex={true}
          roles={["admin"]}
        />
        <HoldToReveal key="exp_features">
          <Option
            btnText={t("settings.experimental-features")}
            icon={<Flask className="h-5 w-5 flex-shrink-0" />}
            href={paths.settings.experimental()}
            user={user}
            flex={true}
            roles={["admin"]}
          />
        </HoldToReveal>
      </>
    )}
  </CanViewChatHistoryProvider>
);

function HoldToReveal({ children, holdForMs = 3_000 }) {
  let timeout = null;
  const [showing, setShowing] = useState(
    window.localStorage.getItem(
      "anythingllm_experimental_feature_preview_unlocked"
    )
  );

  useEffect(() => {
    const onPress = (e) => {
      if (!["Control", "Meta"].includes(e.key) || timeout !== null) return;
      timeout = setTimeout(() => {
        setShowing(true);
        // Setting toastId prevents hook spam from holding control too many times or the event not detaching
        showToast("Experimental feature previews unlocked!");
        window.localStorage.setItem(
          "anythingllm_experimental_feature_preview_unlocked",
          "enabled"
        );
        window.removeEventListener("keypress", onPress);
        window.removeEventListener("keyup", onRelease);
        clearTimeout(timeout);
      }, holdForMs);
    };
    const onRelease = (e) => {
      if (!["Control", "Meta"].includes(e.key)) return;
      if (showing) {
        window.removeEventListener("keypress", onPress);
        window.removeEventListener("keyup", onRelease);
        clearTimeout(timeout);
        return;
      }
      clearTimeout(timeout);
    };

    if (!showing) {
      window.addEventListener("keydown", onPress);
      window.addEventListener("keyup", onRelease);
    }
    return () => {
      window.removeEventListener("keydown", onPress);
      window.removeEventListener("keyup", onRelease);
    };
  }, []);

  if (!showing) return null;
  return children;
}

function AppVersion() {
  const { version, isLoading } = useAppVersion();
  if (isLoading) return null;
  return (
    <Link
      to={`https://github.com/Mintplex-Labs/anything-llm/releases/tag/v${version}`}
      target="_blank"
      rel="noreferrer"
      className="text-theme-text-secondary light:opacity-80 opacity-50 text-xs mx-3"
    >
      v{version}
    </Link>
  );
}
