import {
  ArrowRight,
  Books,
  FileText,
  FolderOpen,
  GitDiff,
  HardDrives,
  Info,
  ListChecks,
  Presentation,
  Sliders,
  Sparkle,
  Wrench,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import protocolResult from "@/media/release-notes/protocol-result.png";
import paths from "@/utils/paths";

import {
  DeploymentSketch,
  SignInSketch,
  ProposalFillSketch,
  IdeasSketch,
} from "./ReleaseSketches";

const FEATURE_ICONS = [Presentation, GitDiff, Sliders, Books];
const WORKBENCH_ICONS = [ListChecks, FolderOpen, FileText, HardDrives];

export default function ReleaseNotes() {
  const { t } = useTranslation();
  const note = (key) => t(`help.november_release.${key}`);
  const heading = "text-lg font-semibold text-white light:text-slate-950";
  const link =
    "inline-flex min-h-10 items-center gap-2 rounded text-sm font-semibold text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 light:text-cyan-800";
  const tools = [
    {
      key: "pdf",
      title: t("local_tools.protocol.title"),
      href: paths.protocolFinder(),
      image: protocolResult,
    },
    {
      key: "proposal",
      title: t("local_tools.title"),
      href: paths.proposalFill(),
      sketch: <ProposalFillSketch />,
    },
  ];

  return (
    <>
      <article
        aria-labelledby="november-title"
        className="space-y-7 text-sm leading-7 text-zinc-300 light:text-slate-700"
      >
        <header>
          <p className="text-sm font-semibold text-cyan-300 light:text-cyan-800">
            {t("help.tabs.new_badge")}
          </p>
          <h1
            id="november-title"
            className="mt-2 text-2xl font-bold tracking-tight text-white light:text-slate-950 md:text-3xl"
          >
            {note("title")}
          </h1>
        </header>
        <div className="grid gap-6 border-y border-white/[0.07] py-6 light:border-slate-200 lg:grid-cols-2">
          <section className="space-y-2">
            <h2 className={heading}>{note("access")}</h2>
            <DeploymentSketch />
            <ul className="list-disc space-y-2 pl-5">
              {t("help.november_release.access_points", {
                returnObjects: true,
              }).map(({ title, text }) => (
                <li key={title}>
                  <strong className="font-semibold">{title}</strong>：{text}
                </li>
              ))}
            </ul>
            <a href="http://101.245.78.174:7555/" className={link}>
              {note("blue")} <ArrowRight size={15} />
            </a>
          </section>
          <section className="space-y-2">
            <h2 className={heading}>{note("accounts")}</h2>
            <SignInSketch />
            <p>{note("sso")}</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>{note("sign_in")}</li>
              <li>{note("existing")}</li>
            </ul>
          </section>
        </div>
        <section>
          <h2 className={heading}>{t("local_tools.nav")}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {tools.map(({ key, title, href, image, sketch }) => (
              <div
                key={key}
                className="overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-950/30 light:border-slate-200 light:bg-slate-50"
              >
                <div
                  className={
                    sketch
                      ? "aspect-[2/1] overflow-hidden border-b border-white/[0.08] bg-[#fdfcf8] light:border-slate-200"
                      : "flex aspect-[2/1] items-center border-b border-white/[0.08] bg-cyan-100/10 px-3 light:border-slate-200 light:bg-cyan-50 sm:px-4"
                  }
                >
                  {sketch || (
                    <img
                      src={image}
                      alt={note(`${key}.alt`)}
                      className="max-h-full w-full rounded-md object-contain"
                    />
                  )}
                </div>
                <div className="px-5 py-4">
                  <h3>
                    <Link className={link} to={href}>
                      {title} <ArrowRight size={15} />
                    </Link>
                  </h3>
                  <p className="mb-2 text-xs text-zinc-400 light:text-slate-600">
                    {t("help.november_release.credit", {
                      name: note(`${key}.contributor`),
                    })}
                  </p>
                  <p>{note(`${key}.description`)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="border-t border-white/[0.07] pt-6 light:border-slate-200">
          <h2 className={`flex items-center gap-2 ${heading}`}>
            <Presentation
              size={22}
              weight="duotone"
              className="shrink-0 text-cyan-300 light:text-cyan-700"
            />
            {note("ppt.title")}
          </h2>
          <p className="mt-2 max-w-3xl">{note("ppt.description")}</p>
        </section>
        <section className="grid items-center gap-5 border-t border-white/[0.07] pt-6 light:border-slate-200 lg:grid-cols-2">
          <div className="space-y-2">
            <h2 className={heading}>{note("feedback_title")}</h2>
            <p>{note("feedback")}</p>
            <p>{note("feedback_prompt")}</p>
          </div>
          <IdeasSketch />
        </section>
      </article>
      <details className="mt-8 border-t border-white/[0.07] pt-3 light:border-slate-200">
        <summary className="cursor-pointer rounded py-3 text-base font-semibold text-zinc-200 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 light:text-slate-800 light:hover:text-cyan-800">
          {t("help.release_notes.badge")} · {t("help.release_notes.title")}
        </summary>
        <SeptemberRelease />
      </details>
    </>
  );
}

function SeptemberRelease() {
  const { t } = useTranslation();
  const rawFeatures = t("help.release_notes.features", {
    returnObjects: true,
  });
  const features = Array.isArray(rawFeatures) ? rawFeatures : [];

  const rawWorkbenchItems = t("help.release_notes.workbench.items", {
    returnObjects: true,
  });
  const workbenchItems = Array.isArray(rawWorkbenchItems)
    ? rawWorkbenchItems
    : [];

  const rawFixTags = t("help.release_notes.fixes.tags", {
    returnObjects: true,
  });
  const fixTags = Array.isArray(rawFixTags) ? rawFixTags : [];

  return (
    <article className="space-y-10" aria-label={t("help.release_notes.title")}>
      <header className="max-w-3xl">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-300 light:border-cyan-600/30 light:bg-cyan-50 light:text-cyan-800">
          <Sparkle size={14} weight="fill" />
          <span>{t("help.release_notes.badge")}</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-white light:text-slate-950 md:text-3xl">
          {t("help.release_notes.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300 light:text-slate-700 md:text-base">
          {t("help.release_notes.description")}
        </p>
      </header>

      <section aria-labelledby="rn-features-title">
        <h2 id="rn-features-title" className="sr-only">
          {t("help.release_notes.title")}
        </h2>
        <div className="grid gap-5 md:grid-cols-2">
          {features.map((feature, index) => {
            const Icon = FEATURE_ICONS[index] || Sparkle;
            return (
              <div
                key={feature.title}
                className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-zinc-950/30 p-5 transition-colors hover:border-white/[0.14] light:border-slate-200 light:bg-slate-50 light:hover:border-slate-300 md:p-6"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 light:border-cyan-600/20 light:bg-cyan-100/50 light:text-cyan-800">
                      <Icon size={20} weight="duotone" />
                    </span>
                    <h3 className="text-base font-semibold text-white light:text-slate-950">
                      {feature.title}
                    </h3>
                  </div>
                  <p className="mt-3.5 text-xs leading-6 text-zinc-400 light:text-slate-600 md:text-sm">
                    {feature.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section
        className="border-t border-white/[0.07] pt-8 light:border-slate-200"
        aria-labelledby="rn-workbench-title"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 light:text-slate-500">
          CoreGenie Workbench
        </p>
        <h2
          id="rn-workbench-title"
          className="mt-1 text-xl font-semibold text-white light:text-slate-950"
        >
          {t("help.release_notes.workbench.title")}
        </h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {workbenchItems.map((item, index) => {
            const Icon = WORKBENCH_ICONS[index] || ListChecks;
            return (
              <div
                key={item.title}
                className="flex gap-3.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4 light:border-slate-200 light:bg-white"
              >
                <Icon
                  size={20}
                  weight="duotone"
                  className="mt-0.5 shrink-0 text-cyan-300 light:text-cyan-700"
                />
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200 light:text-slate-800">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-400 light:text-slate-600">
                    {item.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section
        className="border-t border-white/[0.07] pt-8 light:border-slate-200"
        aria-labelledby="rn-fixes-title"
      >
        <div className="flex items-center gap-2">
          <Wrench
            size={18}
            weight="duotone"
            className="text-cyan-300 light:text-cyan-700"
          />
          <h2
            id="rn-fixes-title"
            className="text-base font-semibold text-white light:text-slate-950"
          >
            {t("help.release_notes.fixes.title")}
          </h2>
        </div>
        <p className="mt-2 text-xs leading-6 text-zinc-400 light:text-slate-600 md:text-sm">
          {t("help.release_notes.fixes.description")}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {fixTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 light:border-slate-200 light:bg-slate-100 light:text-slate-700"
            >
              {tag}
            </span>
          ))}
        </div>
      </section>

      <footer className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-4 light:border-amber-500/20 light:bg-amber-50/50">
        <div className="flex items-start gap-2.5">
          <Info
            size={17}
            weight="duotone"
            className="mt-0.5 shrink-0 text-amber-300 light:text-amber-700"
          />
          <p className="text-xs leading-5 text-amber-200/80 light:text-amber-800">
            {t("help.release_notes.disclaimer")}
          </p>
        </div>
      </footer>
    </article>
  );
}
