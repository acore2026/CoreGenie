import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import {
  ArrowSquareOut,
  FileCode,
  ListBullets,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  ARCHITECTURE_DOCS,
  findArchitectureDoc,
  type ArchitectureDocId,
} from "./docsRegistry";
import {
  REPOSITORY_BASE_URL,
  renderArchitectureMarkdown,
} from "./markdownRenderer";
import "./ArchitectureDocs.css";

interface ArchitectureDocsProps {
  activeDocId: string | null;
  onSelectDoc: (docId: ArchitectureDocId) => void;
}

interface LightboxDiagram {
  src: string;
  alt: string;
}

const SANITIZE_CONFIG = {
  ADD_TAGS: ["figure", "figcaption", "button"],
  ADD_ATTR: [
    "target",
    "rel",
    "loading",
    "aria-label",
    "data-arch-doc",
    "data-repo-path",
    "data-diagram-src",
    "data-diagram-alt",
  ],
};

export default function ArchitectureDocs({
  activeDocId,
  onSelectDoc,
}: ArchitectureDocsProps) {
  const { t } = useTranslation();
  const articleRef = useRef<HTMLDivElement | null>(null);
  const [lightbox, setLightbox] = useState<LightboxDiagram | null>(null);

  const activeDoc = useMemo(
    () => findArchitectureDoc(activeDocId),
    [activeDocId]
  );

  const rendered = useMemo(
    () => renderArchitectureMarkdown(activeDoc),
    [activeDoc]
  );

  const safeHtml = useMemo(
    () => DOMPurify.sanitize(rendered.html, SANITIZE_CONFIG),
    [rendered.html]
  );

  useEffect(() => {
    const scrollContainer = articleRef.current?.closest("main");
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [activeDoc.id]);

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  function handleProseClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const diagramTrigger = target.closest<HTMLButtonElement>(
      "button[data-diagram-src]"
    );
    if (diagramTrigger) {
      const src = diagramTrigger.getAttribute("data-diagram-src");
      if (src) {
        setLightbox({
          src,
          alt: diagramTrigger.getAttribute("data-diagram-alt") || "",
        });
      }
      return;
    }

    const docLink = target.closest<HTMLAnchorElement>("a[data-arch-doc]");
    if (
      docLink &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      const targetDocId = docLink.getAttribute("data-arch-doc");
      if (targetDocId) {
        event.preventDefault();
        onSelectDoc(findArchitectureDoc(targetDocId).id);
      }
    }
  }

  function jumpToHeading(headingId: string) {
    const el = document.getElementById(headingId);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const overviewDocs = ARCHITECTURE_DOCS.filter((doc) => doc.layer === "L1");
  const topicDocs = ARCHITECTURE_DOCS.filter((doc) => doc.layer === "L2");
  const sourceGithubUrl = `${REPOSITORY_BASE_URL}/blob/master/${activeDoc.sourcePath}`;

  return (
    <div ref={articleRef} className="space-y-6">
      {/* Mobile / tablet compact doc switcher */}
      <div className="lg:hidden">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 light:text-slate-500">
          {t("help.architecture.nav_label")}
        </p>
        <div
          role="tablist"
          aria-label={t("help.architecture.nav_label")}
          className="flex gap-2 overflow-x-auto pb-2"
        >
          {ARCHITECTURE_DOCS.map((doc) => {
            const active = doc.id === activeDoc.id;
            return (
              <button
                key={doc.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => onSelectDoc(doc.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
                  active
                    ? "border-cyan-300/40 bg-cyan-300/[0.12] text-cyan-200 light:border-cyan-600/40 light:bg-cyan-50 light:text-cyan-900"
                    : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-100 light:border-slate-200 light:bg-white light:text-slate-600 light:hover:border-slate-300 light:hover:text-slate-950"
                }`}
              >
                <span className="font-mono text-[10px] opacity-75">
                  {doc.layer}
                </span>
                <span>{doc.shortTitle}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
        {/* Desktop sticky navigation */}
        <aside
          aria-label={t("help.architecture.nav_label")}
          className="hidden space-y-6 lg:sticky lg:top-6 lg:block"
        >
          <div className="rounded-xl border border-white/[0.08] bg-zinc-950/35 p-3 light:border-slate-200 light:bg-slate-50">
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 light:text-slate-500">
              {t("help.architecture.overview_group")}
            </p>
            <div className="space-y-1">
              {overviewDocs.map((doc) => (
                <DocNavItem
                  key={doc.id}
                  doc={doc}
                  active={doc.id === activeDoc.id}
                  onSelect={onSelectDoc}
                />
              ))}
            </div>

            <p className="mt-4 border-t border-white/[0.07] px-2 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 light:border-slate-200 light:text-slate-500">
              {t("help.architecture.topics_group")}
            </p>
            <div className="space-y-1">
              {topicDocs.map((doc) => (
                <DocNavItem
                  key={doc.id}
                  doc={doc}
                  active={doc.id === activeDoc.id}
                  onSelect={onSelectDoc}
                />
              ))}
            </div>
          </div>

          {rendered.headings.length > 0 && (
            <nav
              aria-label={t("help.architecture.toc_label")}
              className="rounded-xl border border-white/[0.07] bg-zinc-950/20 p-3.5 light:border-slate-200 light:bg-white"
            >
              <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 light:text-slate-500">
                <ListBullets size={14} weight="bold" />
                <span>{t("help.architecture.toc_label")}</span>
              </div>
              <ul className="space-y-1">
                {rendered.headings.map((heading) => (
                  <li key={heading.id}>
                    <button
                      type="button"
                      onClick={() => jumpToHeading(heading.id)}
                      className={`block w-full rounded px-2 py-1 text-left text-xs leading-5 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 light:text-slate-600 light:hover:bg-slate-100 light:hover:text-slate-950 ${
                        heading.level === 3
                          ? "pl-5 text-[11.5px] opacity-85"
                          : ""
                      }`}
                    >
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>

        {/* Reading canvas */}
        <article className="min-w-0">
          <header className="mb-6 border-b border-white/[0.08] pb-5 light:border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-cyan-200 light:border-cyan-600/30 light:bg-cyan-50 light:text-cyan-800">
                  {activeDoc.layer}
                </span>
                <span className="text-xs font-medium text-zinc-400 light:text-slate-500">
                  {activeDoc.viewLabel}
                </span>
              </div>

              <a
                href={sourceGithubUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:border-cyan-300/30 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 light:border-slate-200 light:text-slate-500 light:hover:border-cyan-600/30 light:hover:text-cyan-800"
              >
                <FileCode size={13} />
                <span>{activeDoc.sourcePath}</span>
                <ArrowSquareOut size={12} />
              </a>
            </div>

            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white light:text-slate-950 md:text-3xl">
              {activeDoc.title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-400 light:text-slate-600">
              {activeDoc.summary}
            </p>
          </header>

          <div
            className="arch-prose"
            onClick={handleProseClick}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        </article>
      </div>

      {/* Diagram Lightbox Modal */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("help.architecture.diagram_preview")}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs md:p-8"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-900 shadow-2xl light:border-slate-200 light:bg-white"
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 light:border-slate-200">
              <p className="truncate text-xs font-medium text-zinc-300 light:text-slate-700">
                {lightbox.alt || t("help.architecture.diagram_preview")}
              </p>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label={t("help.architecture.close_preview")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 light:text-slate-500 light:hover:bg-slate-100 light:hover:text-slate-950"
              >
                <X size={16} weight="bold" />
              </button>
            </div>
            <div className="overflow-auto bg-[#fdfcf8] p-3 md:p-6">
              <img
                src={lightbox.src}
                alt={lightbox.alt}
                className="mx-auto h-auto max-w-full rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface DocNavItemProps {
  doc: (typeof ARCHITECTURE_DOCS)[number];
  active: boolean;
  onSelect: (docId: ArchitectureDocId) => void;
}

function DocNavItem({ doc, active, onSelect }: DocNavItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(doc.id)}
      aria-current={active ? "page" : undefined}
      className={`block w-full rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
        active
          ? "bg-cyan-300/[0.11] text-white light:bg-cyan-50 light:text-slate-950"
          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100 light:text-slate-600 light:hover:bg-white light:hover:text-slate-950"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">{doc.shortTitle}</span>
        <span
          className={`shrink-0 font-mono text-[10px] ${
            active
              ? "text-cyan-300 light:text-cyan-700"
              : "text-zinc-600 light:text-slate-400"
          }`}
        >
          {doc.viewLabel}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500 light:text-slate-500">
        {doc.summary}
      </p>
    </button>
  );
}
