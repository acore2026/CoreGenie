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
import { RouteErrorFallback } from "@/components/ErrorBoundaryFallback";
import { installChunkRecovery } from "@/utils/chunkRecovery";

const isDev = import.meta.env.DEV;
const REACTWRAP = isDev ? React.Fragment : React.StrictMode;

installChunkRecovery();

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <RouteErrorFallback />,
    children: [
      {
        path: "/",
        lazy: async () => {
          const Main = React.lazy(() => import("@/pages/Main"));
          const { default: Landing } = await import("@/pages/Landing");
          return {
            element: <PrivateRoute Component={Main} GuestComponent={Landing} />,
          };
        },
      },
      {
        path: "/welcome",
        lazy: async () => {
          const { default: Landing } = await import("@/pages/Landing");
          return { element: <Landing /> };
        },
      },
      {
        path: "/skills",
        lazy: async () => {
          const { default: PersonalSkills } = await import(
            "@/pages/PersonalSkills"
          );
          return { element: <PrivateRoute Component={PersonalSkills} /> };
        },
      },
      {
        path: "/tools",
        lazy: async () => {
          const { default: ToolCatalog } = await import(
            "@/pages/LocalTools/Catalog"
          );
          return { element: <PrivateRoute Component={ToolCatalog} /> };
        },
      },
      {
        path: "/tools/protocol-finder",
        lazy: async () => {
          const { default: ProtocolFinder } = await import(
            "@/pages/LocalTools/ProtocolFinder"
          );
          return { element: <PrivateRoute Component={ProtocolFinder} /> };
        },
      },
      {
        path: "/tools/proposal-fill",
        lazy: async () => {
          const { default: LocalTools } = await import("@/pages/LocalTools");
          return { element: <PrivateRoute Component={LocalTools} /> };
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
        path: "/oauth/complete",
        lazy: async () => {
          const { OAuthComplete } = await import("@/pages/Login/OAuth");
          return { element: <OAuthComplete /> };
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
        path: "/settings/agents/quick-tasks",
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
        path: "/settings/announcements",
        lazy: async () => {
          const { default: Announcements } = await import(
            "@/pages/Admin/Announcements"
          );
          return { element: <AdminRoute Component={Announcements} /> };
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
      {
        path: "/settings/global-knowledge",
        lazy: async () => {
          const { default: GlobalKnowledge } = await import(
            "@/pages/Admin/GlobalKnowledge"
          );
          return { element: <PrivateRoute Component={GlobalKnowledge} /> };
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
