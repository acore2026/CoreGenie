import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ConfigSync from "@/models/configSync";

const buttonClass =
  "min-h-[40px] rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-theme-text-primary transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 light:border-slate-200 light:hover:bg-slate-100";

function preview(value) {
  if (typeof value === "string") return value;
  if (!value) return "";
  if (value.skillMd)
    return `${value.skillMd}\n${JSON.stringify({ archived: value.archived, files: Object.keys(value.files || {}) }, null, 2)}`;
  return JSON.stringify(value, null, 2);
}

export default function ConfigSyncPanel({ onResolved }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let active = true;
    let timeout;
    const poll = async () => {
      try {
        const next = await ConfigSync.status();
        if (active) {
          setStatus(next);
          setError("");
        }
      } catch (err) {
        if (active) setError(err.message || t("config_sync.request_error"));
      }
      if (active) timeout = setTimeout(poll, 5000);
    };
    poll();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [t]);

  async function act(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message || t("config_sync.request_error"));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(side) {
    const next = await ConfigSync.resolve(detail, side);
    setStatus(next);
    setDetail(null);
    onResolved?.();
  }

  const issues =
    status?.items?.filter((item) => item.status !== "synced") || [];
  return (
    <details className="mx-5 my-4 rounded-xl border border-white/[0.08] text-theme-text-primary light:border-slate-200">
      <summary className="cursor-pointer rounded-xl p-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
        {t("config_sync.title")}
        <span
          className="ml-3 text-xs font-normal text-theme-text-secondary"
          role="status"
        >
          {!status
            ? t("config_sync.loading")
            : !status.enabled
              ? t("config_sync.disabled")
              : issues.length
                ? t("config_sync.issue_count", { count: issues.length })
                : status.error
                  ? t("config_sync.error")
                  : t("config_sync.synced")}
        </span>
      </summary>
      <div className="space-y-4 border-t border-white/[0.08] p-4 light:border-slate-200">
        <p className="text-xs leading-5 text-theme-text-secondary">
          {t(status?.enabled ? "config_sync.description" : "config_sync.setup")}
        </p>
        {status?.directory && (
          <p className="break-all font-mono text-xs text-theme-text-secondary">
            {status.directory}
          </p>
        )}
        {(error || status?.error) && (
          <p
            role="alert"
            className="break-words text-sm text-red-400 light:text-red-700"
          >
            {error || status.error}
          </p>
        )}
        {status?.enabled && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => act(async () => setStatus(await ConfigSync.retry()))}
          >
            {t(busy ? "config_sync.working" : "config_sync.retry")}
          </button>
        )}
        {issues.map((item) => (
          <div
            key={item.key}
            className="flex flex-col gap-3 border-t border-white/[0.08] pt-4 sm:flex-row sm:items-center sm:justify-between light:border-slate-200"
          >
            <div className="min-w-0">
              <p className="break-all text-sm font-medium">{item.name}</p>
              <p className="mt-1 break-words text-xs text-amber-300 light:text-amber-700">
                {item.error || t("config_sync.conflict")}
              </p>
            </div>
            <button
              type="button"
              className={`${buttonClass} shrink-0`}
              disabled={busy}
              onClick={() =>
                act(async () => setDetail(await ConfigSync.detail(item.key)))
              }
            >
              {t("config_sync.compare")}
            </button>
          </div>
        ))}
        {detail && (
          <section
            aria-label={t("config_sync.compare")}
            className="space-y-3 border-t border-white/[0.08] pt-4 light:border-slate-200"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="break-all text-sm font-semibold">{detail.key}</p>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => setDetail(null)}
              >
                {t("config_sync.close")}
              </button>
            </div>
            <p className="text-xs text-theme-text-secondary">
              {t("config_sync.choose_hint")}
            </p>
            {detail.error && (
              <p
                role="alert"
                className="break-words text-xs text-red-400 light:text-red-700"
              >
                {detail.error}
              </p>
            )}
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {["file", "database"].map((side) => (
                <div key={side} className="min-w-0 space-y-3">
                  <h3 className="text-sm font-medium">
                    {t(`config_sync.${side}`)}
                  </h3>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-theme-bg-container p-3 text-xs leading-5">
                    {preview(detail[side]) || t("config_sync.missing")}
                  </pre>
                  <button
                    type="button"
                    disabled={busy || detail[side] === null || !!detail.error}
                    className={buttonClass}
                    onClick={() => act(() => resolve(side))}
                  >
                    {t(
                      busy ? "config_sync.working" : `config_sync.use_${side}`
                    )}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </details>
  );
}
