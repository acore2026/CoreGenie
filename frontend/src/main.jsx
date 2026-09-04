import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "@/App.jsx";
import PrivateRoute, {
  AdminRoute,
  ManagerRoute,
  SingleUserRoute,
} from "@/components/PrivateRoute";
import Login from "@/pages/Login";
import SimpleSSOPassthrough from "@/pages/Login/SSO/simple";
import OnboardingFlow from "@/pages/OnboardingFlow";
import "@/index.css";

const isDev = import.meta.env.DEV;
const REACTWRAP = isDev ? React.Fragment : React.StrictMode;

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "/",
        lazy: async () => {
          const { default: Main } = await import("@/pages/Main");
          return { element: <PrivateRoute Component={Main} /> };
        },
      },
      {
        path: "/help",
        lazy: async () => {
          const { default: Help } = await import("@/pages/Help");
          return { element: <PrivateRoute Component={Help} /> };
        },
      },
      {
        path: "/login",
        element: <Login />,
      },
      {
        path: "/register",
        lazy: async () => {
          const { default: Register } = await import("@/pages/Register");
          return { element: <Register /> };
        },
      },
      {
        path: "/share/chat/:token",
        lazy: async () => {
          const { default: PublicChatShare } = await import(
            "@/pages/PublicChatShare"
          );
          return { element: <PublicChatShare /> };
        },
      },
      {
        path: "/sso/simple",
        element: <SimpleSSOPassthrough />,
      },
      {
        path: "/workspace/:slug/settings/:tab",
        lazy: async () => {
          const { default: WorkspaceSettings } = await import(
            "@/pages/WorkspaceSettings"
          );
          return { element: <ManagerRoute Component={WorkspaceSettings} /> };
        },
      },
      {
        path: "/workspace/:slug",
        lazy: async () => {
          const { default: WorkspaceChat } = await import(
            "@/pages/WorkspaceChat"
          );
          return { element: <PrivateRoute Component={WorkspaceChat} /> };
        },
        children: [{ path: "t/:threadSlug" }],
      },
      {
        path: "/workspace/:slug/jobs",
        lazy: async () => {
          const { default: ScheduledJobs } = await import(
            "@/pages/GeneralSettings/ScheduledJobs"
          );
          return { element: <PrivateRoute Component={ScheduledJobs} /> };
        },
      },
      {
        path: "/workspace/:slug/jobs/:id/runs",
        lazy: async () => {
          const { default: ScheduledJobRuns } = await import(
            "@/pages/GeneralSettings/ScheduledJobs/RunHistoryPage"
          );
          return { element: <PrivateRoute Component={ScheduledJobRuns} /> };
        },
      },
      {
        path: "/workspace/:slug/jobs/:id/runs/:runId",
        lazy: async () => {
          const { default: ScheduledJobRunDetail } = await import(
            "@/pages/GeneralSettings/ScheduledJobs/RunDetailPage"
          );
          return {
            element: <PrivateRoute Component={ScheduledJobRunDetail} />,
          };
        },
      },
      {
        path: "/accept-invite/:code",
        lazy: async () => {
          const { default: InvitePage } = await import("@/pages/Invite");
          return { element: <InvitePage /> };
        },
      },
      // Admin routes
      {
        path: "/settings/llm-preference",
        lazy: async () => {
          const { default: GeneralLLMPreference } = await import(
            "@/pages/GeneralSettings/LLMPreference"
          );
          return { element: <AdminRoute Component={GeneralLLMPreference} /> };
        },
      },
      {
        path: "/settings/transcription-preference",
        lazy: async () => {
          const { default: GeneralTranscriptionPreference } = await import(
            "@/pages/GeneralSettings/TranscriptionPreference"
          );
          return {
            element: <AdminRoute Component={GeneralTranscriptionPreference} />,
          };
        },
      },
      {
        path: "/settings/audio-preference",
        lazy: async () => {
          const { default: GeneralAudioPreference } = await import(
            "@/pages/GeneralSettings/AudioPreference"
          );
          return {
            element: <AdminRoute Component={GeneralAudioPreference} />,
          };
        },
      },
      {
        path: "/settings/embedding-preference",
        lazy: async () => {
          const { default: GeneralEmbeddingPreference } = await import(
            "@/pages/GeneralSettings/EmbeddingPreference"
          );
          return {
            element: <AdminRoute Component={GeneralEmbeddingPreference} />,
          };
        },
      },
      {
        path: "/settings/text-splitter-preference",
        lazy: async () => {
          const { default: EmbeddingTextSplitterPreference } = await import(
            "@/pages/GeneralSettings/EmbeddingTextSplitterPreference"
          );
          return {
            element: <AdminRoute Component={EmbeddingTextSplitterPreference} />,
          };
        },
      },
      {
        path: "/settings/vector-database",
        lazy: async () => {
          const { default: GeneralVectorDatabase } = await import(
            "@/pages/GeneralSettings/VectorDatabase"
          );
          return {
            element: <AdminRoute Component={GeneralVectorDatabase} />,
          };
        },
      },
      {
        path: "/settings/agents",
        lazy: async () => {
          const { default: AdminAgents } = await import("@/pages/Admin/Agents");
          return { element: <AdminRoute Component={AdminAgents} /> };
        },
      },
      {
        path: "/settings/agents/skills",
        lazy: async () => {
          const { default: AdminAgents } = await import("@/pages/Admin/Agents");
          return { element: <AdminRoute Component={AdminAgents} /> };
        },
      },
      {
        path: "/settings/agents/tools",
        lazy: async () => {
          const { default: AdminAgents } = await import("@/pages/Admin/Agents");
          return { element: <AdminRoute Component={AdminAgents} /> };
        },
      },
      {
        path: "/settings/agents/prompts",
        lazy: async () => {
          const { default: AgentPromptSettings } = await import(
            "@/pages/Admin/Agents/PromptSettings"
          );
          return { element: <AdminRoute Component={AgentPromptSettings} /> };
        },
      },
      {
        path: "/settings/agents/feedback",
        lazy: async () => {
          const { default: AgentFeedbackSettings } = await import(
            "@/pages/Admin/Agents/FeedbackSettings"
          );
          return { element: <AdminRoute Component={AgentFeedbackSettings} /> };
        },
      },
      {
        path: "/settings/event-logs",
        lazy: async () => {
          const { default: AdminLogs } = await import("@/pages/Admin/Logging");
          return { element: <AdminRoute Component={AdminLogs} /> };
        },
      },
      {
        path: "/settings/embed-chat-widgets",
        lazy: async () => {
          const { default: ChatEmbedWidgets } = await import(
            "@/pages/GeneralSettings/ChatEmbedWidgets"
          );
          return { element: <AdminRoute Component={ChatEmbedWidgets} /> };
        },
      },
      // Manager routes
      {
        path: "/settings/security",
        lazy: async () => {
          const { default: GeneralSecurity } = await import(
            "@/pages/GeneralSettings/Security"
          );
          return { element: <AdminRoute Component={GeneralSecurity} /> };
        },
      },
      {
        path: "/settings/privacy",
        lazy: async () => {
          const { default: PrivacyAndData } = await import(
            "@/pages/GeneralSettings/PrivacyAndData"
          );
          return { element: <AdminRoute Component={PrivacyAndData} /> };
        },
      },
      {
        path: "/settings/interface",
        lazy: async () => {
          const { default: InterfaceSettings } = await import(
            "@/pages/GeneralSettings/Settings/Interface"
          );
          return { element: <ManagerRoute Component={InterfaceSettings} /> };
        },
      },
      {
        path: "/settings/branding",
        lazy: async () => {
          const { default: BrandingSettings } = await import(
            "@/pages/GeneralSettings/Settings/Branding"
          );
          return { element: <ManagerRoute Component={BrandingSettings} /> };
        },
      },
      {
        path: "/settings/chat",
        lazy: async () => {
          const { default: ChatSettings } = await import(
            "@/pages/GeneralSettings/Settings/Chat"
          );
          return { element: <ManagerRoute Component={ChatSettings} /> };
        },
      },
      {
        path: "/settings/beta-features",
        lazy: async () => {
          const { default: ExperimentalFeatures } = await import(
            "@/pages/Admin/ExperimentalFeatures"
          );
          return { element: <AdminRoute Component={ExperimentalFeatures} /> };
        },
      },
      {
        path: "/settings/api-keys",
        lazy: async () => {
          const { default: GeneralApiKeys } = await import(
            "@/pages/GeneralSettings/ApiKeys"
          );
          return { element: <AdminRoute Component={GeneralApiKeys} /> };
        },
      },
      {
        path: "/settings/system-prompt-variables",
        lazy: async () => {
          const { default: SystemPromptVariables } = await import(
            "@/pages/Admin/SystemPromptVariables"
          );
          return {
            element: <AdminRoute Component={SystemPromptVariables} />,
          };
        },
      },
      {
        path: "/settings/browser-extension",
        lazy: async () => {
          const { default: GeneralBrowserExtension } = await import(
            "@/pages/GeneralSettings/BrowserExtensionApiKey"
          );
          return {
            element: <ManagerRoute Component={GeneralBrowserExtension} />,
          };
        },
      },
      {
        path: "/settings/workspace-chats",
        lazy: async () => {
          const { default: GeneralChats } = await import(
            "@/pages/GeneralSettings/Chats"
          );
          return { element: <ManagerRoute Component={GeneralChats} /> };
        },
      },
      {
        path: "/settings/invites",
        lazy: async () => {
          const { default: AdminInvites } = await import(
            "@/pages/Admin/Invitations"
          );
          return { element: <ManagerRoute Component={AdminInvites} /> };
        },
      },
      {
        path: "/settings/users",
        lazy: async () => {
          const { default: AdminUsers } = await import("@/pages/Admin/Users");
          return { element: <ManagerRoute Component={AdminUsers} /> };
        },
      },
      {
        path: "/settings/workspaces",
        lazy: async () => {
          const { default: AdminWorkspaces } = await import(
            "@/pages/Admin/Workspaces"
          );
          return { element: <ManagerRoute Component={AdminWorkspaces} /> };
        },
      },
      // Onboarding Flow
      {
        path: "/onboarding",
        element: <OnboardingFlow />,
      },
      {
        path: "/onboarding/:step",
        element: <OnboardingFlow />,
      },
      // Experimental feature pages
      {
        path: "/settings/beta-features/live-document-sync/manage",
        lazy: async () => {
          const { default: LiveDocumentSyncManage } = await import(
            "@/pages/Admin/ExperimentalFeatures/Features/LiveSync/manage"
          );
          return {
            element: <AdminRoute Component={LiveDocumentSyncManage} />,
          };
        },
      },
      {
        path: "/settings/mobile-connections",
        lazy: async () => {
          const { default: MobileConnections } = await import(
            "@/pages/GeneralSettings/MobileConnections"
          );
          return { element: <ManagerRoute Component={MobileConnections} /> };
        },
      },
      {
        path: "/settings/external-connections/telegram",
        lazy: async () => {
          const { default: TelegramBotSettings } = await import(
            "@/pages/GeneralSettings/Connections/TelegramBot"
          );
          return { element: <AdminRoute Component={TelegramBotSettings} /> };
        },
      },
      {
        path: "/settings/scheduled-jobs",
        lazy: async () => {
          const { default: ScheduledJobs } = await import(
            "@/pages/GeneralSettings/ScheduledJobs"
          );
          return { element: <SingleUserRoute Component={ScheduledJobs} /> };
        },
      },
      {
        path: "/settings/scheduled-jobs/:id/runs",
        lazy: async () => {
          const { default: ScheduledJobRuns } = await import(
            "@/pages/GeneralSettings/ScheduledJobs/RunHistoryPage"
          );
          return { element: <SingleUserRoute Component={ScheduledJobRuns} /> };
        },
      },
      {
        path: "/settings/scheduled-jobs/:id/runs/:runId",
        lazy: async () => {
          const { default: ScheduledJobRunDetail } = await import(
            "@/pages/GeneralSettings/ScheduledJobs/RunDetailPage"
          );
          return {
            element: <SingleUserRoute Component={ScheduledJobRunDetail} />,
          };
        },
      },
      // Catch-all route for 404s
      {
        path: "*",
        lazy: async () => {
          const { default: NotFound } = await import("@/pages/404");
          return { element: <NotFound /> };
        },
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <REACTWRAP>
    <RouterProvider router={router} />
  </REACTWRAP>
);
