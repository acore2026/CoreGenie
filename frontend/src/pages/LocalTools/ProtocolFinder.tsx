import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isMobile } from "react-device-detect";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import paths from "@/utils/paths";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

interface Entry {
  version: string;
  date?: string;
}
interface Result {
  type: string;
  id: string;
  title?: string;
  dir: string;
  requested?: string;
  warning?: string;
  index: { entries: Entry[]; checked: string };
}
const control =
  "min-h-[40px] max-w-full rounded-md border border-theme-sidebar-border bg-theme-bg-chat px-3 py-2 text-sm hover:bg-theme-sidebar-item-hover focus-visible:ring-2 focus-visible:ring-primary-button disabled:opacity-50";
async function request(params: Record<string, string>, signal: AbortSignal) {
  const headers = Object.fromEntries(
    Object.entries(baseHeaders()).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
  const response = await fetch(
    API_BASE + "/3gpp/protocol-finder?" + new URLSearchParams(params),
    { headers, signal }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
export default function ProtocolFinder() {
  const { t } = useTranslation();
  const tr = (key: string) => String(t("local_tools.protocol." + key));
  const [input, setInput] = useState(""),
    [result, show] = useState<Result | null>(null),
    [version, select] = useState(""),
    [pdf, link] = useState("");
  const [busy, loading] = useState(false),
    [error, fail] = useState(""),
    [message, notify] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load(q: string, refresh = false) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    loading(true);
    show(null);
    select("");
    link("");
    fail("");
    notify("");
    try {
      const data: Result = await request(
        { q, refresh: refresh ? "1" : "0" },
        controller.signal
      );
      if (controller.signal.aborted) return;
      show(data);
      select(data.requested || data.index.entries[0].version);
    } catch (e) {
      if (!controller.signal.aborted)
        fail(e instanceof Error ? e.message : tr("failed"));
    } finally {
      if (!controller.signal.aborted) loading(false);
    }
  }
  const entry = result?.index.entries.find((e) => e.version === version);
  useEffect(() => {
    link("");
    notify("");
    if (!result || !entry) return;
    const controller = new AbortController();
    request(
      { q: result.type + " " + result.id, v: entry.version },
      controller.signal
    )
      .then((data) => {
        if (!controller.signal.aborted) link(data.pdf);
      })
      .catch((e) => {
        if (!controller.signal.aborted) fail(e.message);
      });
    return () => controller.abort();
  }, [result, entry]);
  function pick(v: string) {
    if (v !== version) {
      link("");
      fail("");
      select(v);
    }
  }
  const entries = result?.index.entries || [],
    release = version.split(".")[0];
  const releases = [...new Set(entries.map((e) => e.version.split(".")[0]))];
  async function copy() {
    const citation =
      "3GPP " +
      result!.type +
      " " +
      result!.id +
      " V" +
      version +
      ", Release " +
      release +
      ". " +
      pdf;
    try {
      await navigator.clipboard.writeText(citation);
      notify(tr("copied"));
    } catch {
      notify(tr("manual") + "：" + citation);
    }
  }
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-theme-bg-chat text-theme-text-primary">
      {isMobile ? <SidebarMobileHeader /> : <Sidebar />}
      <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-12 pt-24 md:px-8 md:pt-8">
        <div className="mx-auto max-w-5xl space-y-5">
          <Link className={control + " inline-block"} to={paths.tools()}>
            ← {t("local_tools.back_to_tools")}
          </Link>
          <h1 className="text-2xl font-semibold">{tr("title")}</h1>
          <p className="text-sm text-theme-text-secondary">
            {tr("description")}
          </p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              load(input.trim());
            }}
          >
            <label className="grid min-w-0 flex-1 gap-2">
              {tr("label")}
              <input
                className={control}
                placeholder={tr("hint")}
                value={input}
                maxLength={100}
                onChange={(e) => setInput(e.target.value)}
              />
            </label>
            <button className={control} disabled={!input.trim() || busy}>
              {tr(busy ? "loading" : "search")}
            </button>
          </form>
          {result && (
            <section className="space-y-4 rounded-lg border border-theme-sidebar-border p-4">
              <h2 className="text-lg font-semibold">
                {result.type} {result.id} {result.title}
              </h2>
              <div className="flex flex-wrap gap-4">
                <label>
                  {tr("release")}{" "}
                  <select
                    className={control}
                    value={release}
                    onChange={(e) =>
                      pick(
                        entries.find(
                          (x) => x.version.split(".")[0] === e.target.value
                        )!.version
                      )
                    }
                  >
                    {!releases.includes(release) && <option>{release}</option>}
                    {releases.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {tr("revision")}{" "}
                  <select
                    className={control}
                    value={version}
                    onChange={(e) => pick(e.target.value)}
                  >
                    {!entry && <option>{version}</option>}
                    {entries
                      .filter((e) => e.version.split(".")[0] === release)
                      .map((e) => (
                        <option key={e.version}>{e.version}</option>
                      ))}
                  </select>
                </label>
              </div>
              {entry ? (
                <p className="text-sm">
                  {tr("folder")} · {entry.date}
                </p>
              ) : (
                <p>{tr("missing")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {pdf ? (
                  <a
                    className={control}
                    href={pdf}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tr("open")} ↗
                  </a>
                ) : (
                  entry && !error && <span role="status">{tr("loading")}</span>
                )}
                <button className={control} disabled={!pdf} onClick={copy}>
                  {tr("copy")}
                </button>
                <a
                  className={control}
                  href={result.dir}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr("directory")} ↗
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-theme-text-secondary">
                {tr("checked")} ·{" "}
                {new Date(result.index.checked).toLocaleString("zh-CN")}
                <button
                  className={control}
                  onClick={() =>
                    load(result.type + " " + result.id + " V" + version, true)
                  }
                >
                  {tr("refresh")}
                </button>
              </div>
              {result.warning && <p role="status">{result.warning}</p>}
            </section>
          )}
          {error && <p role="alert">{error}</p>}
          {message && (
            <p className="break-all" role="status">
              {message}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
