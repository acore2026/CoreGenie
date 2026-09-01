import { useEffect, useMemo, useState } from "react";
import { isMobile } from "react-device-detect";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowSquareOut,
  CaretDown,
  CheckCircle,
  Copy,
  FileText,
  FolderOpen,
  GithubLogo,
  Info,
  Question,
  Robot,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import AgentAvatar from "@/components/PredefinedAgents/AgentAvatar";
import usePredefinedAgent from "@/hooks/usePredefinedAgent";
import useUser from "@/hooks/useUser";
import Workspace from "@/models/workspace";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import { PENDING_HELP_DRAFT, SEEN_HELP_INTRO } from "@/utils/constants";

const CAPABILITY_ICONS = [FolderOpen, Sparkle, ShieldCheck, FileText];
const GITHUB_REPOSITORY_URL = "https://github.com/acore2026/anything-llm";

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function agentKind(agent) {
  if (agent?.isBuiltinDefault) return "general";
  if (/转\s*Markdown|Markdown.*助手/i.test(agent?.name || ""))
    return "converter";
  if (/技术路线|立场|position|evolution/i.test(agent?.name || ""))
    return "evolution";
  return "review";
}

export default function Help() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 light:bg-slate-50">
      {!isMobile ? <Sidebar /> : <SidebarMobileHeader />}
      <HelpCenter />
    </div>
  );
}

function HelpCenter() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useUser();
  const {
    agents,
    loading: agentsLoading,
    selectedAgent,
    selectAgent,
  } = usePredefinedAgent();
  const [activeAgentId, setActiveAgentId] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);

  useEffect(() => {
    Workspace.all()
      .then((items) => setWorkspaces(Array.isArray(items) ? items : []))
      .finally(() => setWorkspacesLoading(false));
  }, []);

  useEffect(() => {
    if (!agents.length) return;
    const stillAvailable = agents.some((agent) => agent.id === activeAgentId);
    if (!stillAvailable)
      setActiveAgentId(selectedAgent?.id || agents[0]?.id || null);
  }, [agents, selectedAgent?.id, activeAgentId]);

  const activeAgent =
    agents.find((agent) => agent.id === activeAgentId) || agents[0] || null;
  const kind = agentKind(activeAgent);
  const fallbackExamples = arrayValue(
    t(`help.agent_profiles.${kind}.examples`, { returnObjects: true })
  );
  const examples = useMemo(() => {
    const configured = arrayValue(activeAgent?.examplePrompts)
      .map((prompt) =>
        typeof prompt === "string"
          ? prompt.trim()
          : String(prompt?.prompt || prompt?.label || "").trim()
      )
      .filter(Boolean);
    return (configured.length ? configured : fallbackExamples).slice(0, 3);
  }, [activeAgent, fallbackExamples]);
  const noWorkspace = !workspacesLoading && workspaces.length === 0;
  const launchBlocked = noWorkspace && user?.role === "default";
  const capabilities = arrayValue(
    t("help.capabilities.items", { returnObjects: true })
  );
  const painPoints = arrayValue(
    t("help.pain_points.items", { returnObjects: true })
  );
  const concepts = arrayValue(
    t("help.concepts.items", { returnObjects: true })
  );
  const boundaries = arrayValue(
    t("help.boundaries.items", { returnObjects: true })
  );
  const faqItems = arrayValue(t("help.faq.items", { returnObjects: true }));

  function launch(agent, prompt) {
    if (!agent || !prompt || launchBlocked) return;
    selectAgent(agent.id);
    localStorage.setItem(SEEN_HELP_INTRO, "true");
    sessionStorage.setItem(
      PENDING_HELP_DRAFT,
      JSON.stringify({ prompt, agentId: agent.id })
    );
    navigate(paths.home());
  }

  async function copyPrompt(prompt) {
    try {
      await navigator.clipboard.writeText(prompt);
      showToast(t("help.actions.copied"), "success");
    } catch {
      showToast(t("help.actions.copy_failed"), "error");
    }
  }

  return (
    <main
      style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
      className="relative h-full w-full overflow-y-auto bg-zinc-900 light:bg-white md:my-4 md:mr-4 md:ml-0.5 md:rounded-2xl md:border md:border-white/[0.07] light:md:border-slate-200"
    >
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-24 md:px-8 md:pb-12 md:pt-8 lg:px-10">
        <PainPoints items={painPoints} t={t} />

        <section
          className="border-t border-white/[0.07] py-8 light:border-slate-200"
          aria-labelledby="agent-launcher-title"
        >
          <div className="mb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80 light:text-cyan-700">
              {t("help.launcher.eyebrow")}
            </p>
            <h2
              id="agent-launcher-title"
              className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-white light:text-slate-950"
            >
              {t("help.launcher.title")}
            </h2>
            <p className="mt-2 text-sm text-zinc-500 light:text-slate-500">
              {t("help.launcher.description")}
            </p>
          </div>

          <div className="grid min-h-[430px] overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-950/30 light:border-slate-200 light:bg-slate-50 lg:grid-cols-[320px_1fr]">
            <div className="border-b border-white/[0.08] p-2 light:border-slate-200 lg:border-r lg:border-b-0">
              {agentsLoading ? (
                <AgentListSkeleton />
              ) : agents.length ? (
                <div
                  className="space-y-1"
                  role="list"
                  aria-label={t("help.launcher.agent_list")}
                >
                  {agents.map((agent) => {
                    const active = agent.id === activeAgent?.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setActiveAgentId(agent.id)}
                        className={`flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
                          active
                            ? "bg-cyan-300/[0.09] text-white light:bg-cyan-50 light:text-slate-950"
                            : "text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100 light:text-slate-600 light:hover:bg-white light:hover:text-slate-950"
                        }`}
                      >
                        <AgentAvatar agent={agent} size={38} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {agent.name}
                          </span>
                          <span className="mt-0.5 block line-clamp-1 text-xs font-normal opacity-60">
                            {t(
                              `help.agent_profiles.${agentKind(agent)}.description`
                            ) || t("help.launcher.ready")}
                          </span>
                        </span>
                        {active && (
                          <ArrowRight
                            size={15}
                            weight="bold"
                            className="shrink-0 text-cyan-300 light:text-cyan-700"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-44 flex-col items-center justify-center px-5 text-center">
                  <Robot size={24} className="text-zinc-600" />
                  <p className="mt-3 text-sm font-medium text-zinc-300 light:text-slate-700">
                    {t("help.launcher.empty_title")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 light:text-slate-500">
                    {t("help.launcher.empty_description")}
                  </p>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col p-5 md:p-6">
              {activeAgent ? (
                <>
                  <div className="flex flex-col gap-5 border-b border-white/[0.07] pb-5 light:border-slate-200 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 max-w-2xl">
                      <span className="inline-flex rounded-md border border-white/[0.08] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 light:border-slate-200 light:text-slate-500">
                        {t(`help.agent_profiles.${kind}.label`)}
                      </span>
                      <h3 className="mt-3 text-xl font-semibold text-white light:text-slate-950">
                        {activeAgent.name}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-zinc-400 light:text-slate-600">
                        {t(`help.agent_profiles.${kind}.description`)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={launchBlocked || !examples[0]}
                      onClick={() => launch(activeAgent, examples[0])}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 transition-[transform,background-color] hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500 light:disabled:bg-slate-200 light:disabled:text-slate-400"
                    >
                      {launchBlocked
                        ? t("help.actions.workspace_required")
                        : t("help.actions.use_agent")}
                      <ArrowRight size={15} weight="bold" />
                    </button>
                  </div>

                  <dl className="grid gap-3 py-5 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3 light:border-slate-200 light:bg-white">
                      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600 light:text-slate-400">
                        {t("help.launcher.input_label")}
                      </dt>
                      <dd className="mt-1.5 text-xs leading-5 text-zinc-300 light:text-slate-700">
                        {t(`help.agent_profiles.${kind}.input`)}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3 light:border-slate-200 light:bg-white">
                      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600 light:text-slate-400">
                        {t("help.launcher.output_label")}
                      </dt>
                      <dd className="mt-1.5 text-xs leading-5 text-zinc-300 light:text-slate-700">
                        {t(`help.agent_profiles.${kind}.output`)}
                      </dd>
                    </div>
                  </dl>

                  <div className="min-h-0 flex-1">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600 light:text-slate-400">
                      {t("help.launcher.examples_label")}
                    </p>
                    <div className="space-y-2">
                      {examples.map((prompt, index) => (
                        <article
                          key={`${prompt}-${index}`}
                          className="group flex flex-col gap-3 rounded-lg border border-white/[0.07] bg-zinc-950/25 p-3 transition-colors hover:border-white/[0.14] light:border-slate-200 light:bg-white light:hover:border-slate-300 sm:flex-row sm:items-center"
                        >
                          <p className="min-w-0 flex-1 text-pretty text-xs leading-5 text-zinc-300 light:text-slate-700">
                            {prompt}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => copyPrompt(prompt)}
                              aria-label={t("help.actions.copy")}
                              title={t("help.actions.copy")}
                              className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 light:hover:bg-slate-100 light:hover:text-slate-900"
                            >
                              <Copy size={15} />
                            </button>
                            <button
                              type="button"
                              disabled={launchBlocked}
                              onClick={() => launch(activeAgent, prompt)}
                              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/[0.07] hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 light:border-slate-200 light:text-slate-700 light:hover:border-cyan-500/30 light:hover:bg-cyan-50 light:hover:text-cyan-800"
                            >
                              {t("help.actions.try_example")}
                              <ArrowRight size={13} weight="bold" />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex h-full min-h-72 items-center justify-center text-sm text-zinc-500">
                  {t("help.launcher.select_agent")}
                </div>
              )}
            </div>
          </div>

          {launchBlocked && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2.5 text-xs leading-5 text-amber-100/75 light:border-amber-500/20 light:bg-amber-50 light:text-amber-800">
              <Info size={15} className="mt-0.5 shrink-0" />
              {t("help.states.no_workspace")}
            </div>
          )}
        </section>

        <section className="grid gap-8 border-t border-white/[0.07] py-8 light:border-slate-200 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 light:text-slate-500">
              {t("help.capabilities.eyebrow")}
            </p>
            <h2 className="mt-1.5 text-xl font-semibold text-white light:text-slate-950">
              {t("help.capabilities.title")}
            </h2>
            <div className="mt-5 divide-y divide-white/[0.07] border-y border-white/[0.07] light:divide-slate-200 light:border-slate-200">
              {capabilities.map((item, index) => {
                const Icon = CAPABILITY_ICONS[index] || CheckCircle;
                return (
                  <div key={item.title} className="flex gap-3 py-4">
                    <Icon
                      size={18}
                      weight="duotone"
                      className="mt-0.5 shrink-0 text-cyan-300 light:text-cyan-700"
                    />
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100 light:text-slate-900">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-zinc-500 light:text-slate-500">
                        {item.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 light:text-slate-500">
              {t("help.concepts.eyebrow")}
            </p>
            <h2 className="mt-1.5 text-xl font-semibold text-white light:text-slate-950">
              {t("help.concepts.title")}
            </h2>
            <dl className="mt-5 space-y-3">
              {concepts.map((item) => (
                <div
                  key={item.term}
                  className="grid gap-1 rounded-lg border border-white/[0.07] px-3 py-3 light:border-slate-200 sm:grid-cols-[92px_1fr] sm:gap-3"
                >
                  <dt className="text-xs font-semibold text-zinc-200 light:text-slate-800">
                    {item.term}
                  </dt>
                  <dd className="text-xs leading-5 text-zinc-500 light:text-slate-500">
                    {item.description}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <Faq items={faqItems} t={t} />

        <section
          className="border-t border-white/[0.07] py-8 light:border-slate-200"
          aria-labelledby="help-contribute-title"
        >
          <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-zinc-400 light:border-slate-200 light:text-slate-600">
                <GithubLogo size={20} weight="duotone" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 light:text-slate-500">
                  {t("help.contribute.eyebrow")}
                </p>
                <h2
                  id="help-contribute-title"
                  className="mt-1 text-base font-semibold text-white light:text-slate-950"
                >
                  {t("help.contribute.title")}
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500 light:text-slate-500">
                  {t("help.contribute.description")}
                </p>
                <p className="mt-1.5 break-all font-mono text-[10px] text-zinc-600 light:text-slate-400">
                  {GITHUB_REPOSITORY_URL.replace(/^https:\/\//, "")}
                </p>
              </div>
            </div>

            <a
              href={GITHUB_REPOSITORY_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-300 transition-[transform,background-color,border-color,color] hover:border-cyan-300/30 hover:bg-cyan-300/[0.07] hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 active:scale-[0.97] light:border-slate-200 light:text-slate-700 light:hover:border-cyan-500/30 light:hover:bg-cyan-50 light:hover:text-cyan-800"
            >
              {t("help.contribute.action")}
              <ArrowSquareOut size={14} weight="bold" />
            </a>
          </div>
        </section>

        <section className="border-t border-white/[0.07] pt-8 light:border-slate-200">
          <div className="flex items-center gap-2">
            <ShieldCheck
              size={18}
              weight="duotone"
              className="text-amber-300 light:text-amber-700"
            />
            <h2 className="text-base font-semibold text-white light:text-slate-950">
              {t("help.boundaries.title")}
            </h2>
          </div>
          <ul className="mt-4 grid gap-3 text-xs leading-5 text-zinc-500 light:text-slate-500 md:grid-cols-3">
            {boundaries.map((item) => (
              <li
                key={item}
                className="border-l border-amber-300/25 pl-3 light:border-amber-600/30"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function PainPoints({ items, t }) {
  return (
    <section className="pb-8" aria-labelledby="help-pain-points-title">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 light:text-slate-500">
        {t("help.pain_points.eyebrow")}
      </p>
      <h2
        id="help-pain-points-title"
        className="mt-1.5 text-xl font-semibold tracking-[-0.015em] text-white light:text-slate-950"
      >
        {t("help.pain_points.title")}
      </h2>

      <ol className="mt-5 grid gap-x-8 sm:grid-cols-2">
        {items.map((item, index) => (
          <li
            key={item.title}
            className="grid grid-cols-[28px_1fr] gap-3 border-t border-white/[0.07] py-4 light:border-slate-200"
          >
            <span className="pt-0.5 font-mono text-[10px] tabular-nums text-cyan-300/70 light:text-cyan-700">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 light:text-slate-900">
                {item.title}
              </h3>
              <dl className="mt-2 space-y-1.5 text-xs leading-5">
                <div className="grid grid-cols-[32px_1fr] gap-2">
                  <dt className="text-zinc-600 light:text-slate-400">
                    {t("help.pain_points.before")}
                  </dt>
                  <dd className="text-zinc-500 light:text-slate-500">
                    {item.before}
                  </dd>
                </div>
                <div className="grid grid-cols-[32px_1fr] gap-2">
                  <dt className="font-medium text-cyan-300/80 light:text-cyan-700">
                    {t("help.pain_points.after")}
                  </dt>
                  <dd className="text-zinc-300 light:text-slate-700">
                    {item.after}
                  </dd>
                </div>
              </dl>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Faq({ items, t }) {
  return (
    <section
      className="border-t border-white/[0.07] py-8 light:border-slate-200"
      aria-labelledby="help-faq-title"
    >
      <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/20 text-cyan-300 light:border-cyan-600/20 light:text-cyan-700">
            <Question size={18} weight="duotone" />
          </span>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 light:text-slate-500">
            {t("help.faq.eyebrow")}
          </p>
          <h2
            id="help-faq-title"
            className="mt-1.5 text-xl font-semibold text-white light:text-slate-950"
          >
            {t("help.faq.title")}
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500 light:text-slate-500">
            {t("help.faq.description")}
          </p>
        </div>

        <div className="divide-y divide-white/[0.07] border-y border-white/[0.07] light:divide-slate-200 light:border-slate-200">
          {items.map((item, index) => (
            <details key={`${item.question}-${index}`} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/70 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 text-sm font-semibold text-zinc-200 light:text-slate-800">
                  {item.question}
                </span>
                <CaretDown
                  size={14}
                  weight="bold"
                  className="shrink-0 text-zinc-600 transition-transform duration-150 group-open:rotate-180 light:text-slate-400"
                />
              </summary>
              <p className="pb-4 pr-8 text-xs leading-5 text-zinc-500 light:text-slate-500">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentListSkeleton() {
  return (
    <div className="space-y-1" aria-label="Loading Agents">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex min-h-16 items-center gap-3 px-3 py-2.5"
        >
          <div className="h-[38px] w-[38px] shrink-0 animate-pulse rounded-lg bg-white/[0.06] light:bg-slate-200" />
          <div className="flex-1">
            <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06] light:bg-slate-200" />
            <div className="mt-2 h-2.5 w-full animate-pulse rounded bg-white/[0.04] light:bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
