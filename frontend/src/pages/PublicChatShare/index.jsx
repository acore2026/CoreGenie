import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowSquareOut,
  Brain,
  ChatCircleDots,
  CircleNotch,
  Eye,
  FileText,
  LinkSimple,
  LockOpen,
  Robot,
  Sparkle,
  User,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import PublicChatShare from "@/models/publicChatShare";
import renderMarkdown from "@/utils/chat/markdown";
import DOMPurify from "@/utils/chat/purify";
import useLogo from "@/hooks/useLogo";

const WEB_SOURCE_PREFIXES = [
  "link://",
  "youtube://",
  "github://",
  "gitlab://",
  "confluence://",
  "drupalwiki://",
];

function getSourceUrl(source) {
  const raw = source?.url || source?.chunkSource || "";
  const prefix = WEB_SOURCE_PREFIXES.find((item) => raw.startsWith(item));
  const candidate = prefix ? raw.slice(prefix.length) : raw;
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    return new URL(candidate).href;
  } catch {
    return null;
  }
}

function cleanSourceExcerpt(text) {
  if (typeof text !== "string" || !text.trim()) return "";
  const withoutMetadata = text.replace(
    /<document_metadata>[\s\S]*?<\/document_metadata>/gi,
    ""
  );
  const document = new DOMParser().parseFromString(
    withoutMetadata,
    "text/html"
  );
  document
    .querySelectorAll("script, style, noscript")
    .forEach((node) => node.remove());
  return (document.body.textContent || withoutMetadata)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function groupSources(sources, fallbackTitle) {
  const grouped = new Map();
  sources.forEach((source, index) => {
    const url = getSourceUrl(source);
    const title = String(
      source?.title ||
        source?.name ||
        (url ? new URL(url).hostname : fallbackTitle(index + 1))
    );
    const key = `${title}\n${url || "file"}`;
    const existing = grouped.get(key) || {
      title,
      url,
      chunks: [],
    };
    existing.chunks.push(source);
    grouped.set(key, existing);
  });
  return [...grouped.values()];
}

function Sources({ sources }) {
  const { t } = useTranslation();
  const grouped = groupSources(sources, (index) =>
    t("chat_window.share_chat.source", { index })
  );

  return (
    <details className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white text-left shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
        <span className="flex items-center gap-2">
          <FileText size={17} className="text-amber-600" />
          {t("chat_window.share_chat.sources", { count: grouped.length })}
        </span>
        <span className="text-xs font-normal text-zinc-500">
          {t("chat_window.share_chat.expand_sources")}
        </span>
      </summary>
      <div className="grid gap-2 border-t border-zinc-100 p-3 sm:grid-cols-2">
        {grouped.map((source, index) => {
          const excerpt = cleanSourceExcerpt(source.chunks[0]?.text);
          const hostname = source.url ? new URL(source.url).hostname : null;
          return (
            <div
              key={`${source.title}-${index}`}
              className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-zinc-900"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-600 ring-1 ring-zinc-200">
                  {source.url ? (
                    <LinkSimple size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-1 font-semibold text-zinc-900 hover:text-amber-700 hover:underline"
                    >
                      <span className="line-clamp-2 break-all">
                        {source.title}
                      </span>
                      <ArrowSquareOut size={14} className="mt-0.5 shrink-0" />
                    </a>
                  ) : (
                    <p className="line-clamp-2 break-all font-semibold text-zinc-900">
                      {source.title}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {hostname || t("chat_window.share_chat.document")}
                    {source.chunks.length > 1
                      ? ` · ${t("chat_window.share_chat.references", { count: source.chunks.length })}`
                      : ""}
                  </p>
                </div>
              </div>
              {excerpt && (
                <details className="mt-2 border-t border-zinc-200 pt-2">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-600 hover:text-zinc-950">
                    {t("chat_window.share_chat.show_excerpt")}
                  </summary>
                  <p className="mt-2 max-h-32 overflow-y-auto text-xs leading-5 text-zinc-600">
                    {excerpt}
                    {excerpt.length >= 420 ? "…" : ""}
                  </p>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function Message({ item }) {
  const { t } = useTranslation();
  const isUser = item.role === "user";
  const rawTrace = Array.isArray(item.agentTrace) ? item.agentTrace : [];
  const trace = rawTrace.length
    ? [
        ...rawTrace.filter(
          (entry) => !["finalizing", "completed"].includes(entry.phase)
        ),
        {
          id: "agent-trace-complete",
          summary: t("chat_window.agent_invocation.session_complete"),
          phase: "completed",
        },
      ]
    : [];
  const sources = Array.isArray(item.sources) ? item.sources : [];
  const contextTraces = Array.isArray(item.contextTraces)
    ? item.contextTraces
    : [];

  return (
    <article
      className={`flex gap-3 md:gap-4 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <div
        className={`mt-1 h-9 w-9 shrink-0 rounded-xl flex items-center justify-center border shadow-sm ${
          isUser
            ? "bg-amber-400 border-amber-300 text-zinc-950"
            : "bg-white border-zinc-200 text-zinc-700"
        }`}
      >
        {isUser ? <User size={18} weight="bold" /> : <Robot size={19} />}
      </div>

      <div
        className={`min-w-0 max-w-[88%] md:max-w-[78%] ${isUser ? "text-right" : ""}`}
      >
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
          {isUser
            ? t("chat_window.share_chat.user")
            : t("chat_window.share_chat.assistant")}
        </p>
        <div
          className={`markdown public-share-markdown overflow-x-auto rounded-2xl px-4 py-3.5 text-left text-[15px] leading-7 shadow-sm ${
            isUser
              ? "public-share-markdown-user bg-amber-300 text-zinc-950"
              : "border border-zinc-200 bg-white text-zinc-900"
          }`}
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(renderMarkdown(item.content || "")),
          }}
        />

        {!isUser && contextTraces.length > 0 && (
          <div className="mt-2 grid gap-1.5 text-left">
            {contextTraces.map((context) => {
              const SkillIcon = context.kind === "skill" ? Sparkle : Brain;
              return (
                <div
                  key={context.id}
                  className="flex h-8 min-w-0 items-center gap-2 rounded-r-lg border-l-2 border-cyan-500 bg-cyan-50/60 px-2.5"
                >
                  <SkillIcon
                    size={14}
                    weight="duotone"
                    className="shrink-0 text-cyan-700"
                  />
                  <span className="shrink-0 text-[9px] font-bold tracking-[0.14em] text-cyan-700">
                    {context.kind === "skill" ? "SKILL" : "MEMORY"}
                  </span>
                  <span className="truncate text-xs font-medium text-zinc-800">
                    {context.title}
                    {context.detail && (
                      <span className="font-normal text-zinc-500">
                        {` · ${context.detail}`}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {trace.length > 0 && (
          <details className="mt-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left shadow-sm">
            <summary className="cursor-pointer text-xs font-medium text-zinc-700">
              {t("chat_window.share_chat.agent_activity", {
                count: trace.length,
              })}
            </summary>
            <ol className="mt-2 space-y-1.5 border-l border-zinc-300 pl-3 text-xs leading-5 text-zinc-600">
              {trace.map((entry, index) => (
                <li key={entry.id || index}>{entry.summary}</li>
              ))}
            </ol>
          </details>
        )}

        {sources.length > 0 && <Sources sources={sources} />}
      </div>
    </article>
  );
}

export default function PublicChatSharePage() {
  const { token } = useParams();
  const { t, i18n } = useTranslation();
  const { logo } = useLogo();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    PublicChatShare.get(token).then((result) => {
      if (!active) return;
      setData(result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [token]);

  const date = data?.share?.createdAt
    ? new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(data.share.createdAt))
    : null;

  return (
    <main className="min-h-screen bg-[#f4f1e8] text-zinc-950 selection:bg-amber-300 selection:text-zinc-950">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-48 left-[18%] h-96 w-96 rounded-full bg-amber-300/25 blur-3xl" />
        <div className="absolute top-[40%] right-[-10rem] h-96 w-96 rounded-full bg-indigo-300/15 blur-3xl" />
      </div>

      <header className="relative border-b border-zinc-200 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-3">
            {logo ? (
              <img
                src={logo}
                alt="CoreGenie"
                className="h-9 max-w-[192px] object-contain object-left"
              />
            ) : (
              <ChatCircleDots size={25} className="text-amber-400" />
            )}
            <span className="hidden h-5 w-px bg-zinc-200 sm:block" />
            <span className="hidden text-sm text-zinc-600 sm:block">
              {t("chat_window.share_chat.public_title")}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            <Eye size={14} />
            {t("chat_window.share_chat.read_only")}
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-5xl px-4 pb-20 pt-10 md:px-8 md:pt-14">
        {loading ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 text-zinc-600">
            <CircleNotch size={28} className="animate-spin text-amber-600" />
            <p className="text-sm">{t("chat_window.share_chat.loading")}</p>
          </div>
        ) : !data?.success ? (
          <div className="mx-auto mt-20 max-w-lg rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-xl">
            <LockOpen size={34} className="mx-auto mb-4 text-zinc-400" />
            <h1 className="text-xl font-semibold">
              {t("chat_window.share_chat.unavailable")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              {t("chat_window.share_chat.unavailable_description")}
            </p>
          </div>
        ) : (
          <>
            <section className="mb-12 border-b border-zinc-300 pb-8">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                <span className="h-px w-7 bg-amber-600" />
                {t("chat_window.share_chat.public_title")}
              </div>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
                {data.share.title}
              </h1>
              <p className="mt-4 text-sm text-zinc-600">
                {t("chat_window.share_chat.shared_from", {
                  workspace: data.share.workspaceName,
                })}
                {date ? ` · ${date}` : ""}
              </p>
            </section>

            {data.history?.length ? (
              <section className="space-y-8 md:space-y-10">
                {data.history.map((item, index) => (
                  <Message
                    key={`${item.chatId || "message"}-${item.role}-${index}`}
                    item={item}
                  />
                ))}
              </section>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/50 py-16 text-center text-sm text-zinc-600">
                {t("chat_window.share_chat.empty")}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
