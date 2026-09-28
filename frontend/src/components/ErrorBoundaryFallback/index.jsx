import { NavLink, useRouteError } from "react-router-dom";
import {
  House,
  ArrowClockwise,
  Copy,
  Check,
  CircleNotch,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import i18n from "@/i18n";
import {
  clearChunkRecovery,
  isDynamicImportError,
  recoverFromChunkError,
} from "@/utils/chunkRecovery";

export default function ErrorBoundaryFallback({ error }) {
  const [copied, setCopied] = useState(false);
  const [recovering, setRecovering] = useState(isDynamicImportError(error));

  useEffect(() => {
    if (!recovering) return;
    if (!recoverFromChunkError(error)) setRecovering(false);
  }, [error, recovering]);

  const reload = () => {
    clearChunkRecovery();
    window.location.reload();
  };

  const copyErrorDetails = async () => {
    const details = {
      url: window.location.href,
      error: error?.name || "Unknown Error",
      message: error?.message || "No message available",
      stack: error?.stack || "No stack trace available",
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };

    const formattedDetails = `
Error Report
============
Timestamp: ${details.timestamp}
URL: ${details.url}
User Agent: ${details.userAgent}

Error: ${details.error}
Message: ${details.message}

Stack Trace:
${details.stack}
    `.trim();

    try {
      await navigator.clipboard.writeText(formattedDetails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy error details:", err);
    }
  };

  if (recovering) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-theme-bg-primary p-6 text-theme-text-primary">
        <CircleNotch
          size={24}
          className="animate-spin text-cyan-400 motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="m-0 text-sm font-medium">
          {i18n.t("app_error.recovering")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-theme-bg-primary p-4 text-theme-text-primary md:p-8">
      <h1 className="text-center text-xl font-semibold md:text-2xl">
        {i18n.t("app_error.title")}
      </h1>
      <p className="max-w-lg px-4 text-center text-sm leading-6 text-theme-text-secondary">
        {i18n.t("app_error.description")}
      </p>
      {import.meta.env.DEV && (
        <div className="w-full max-w-4xl">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={copyErrorDetails}
              className="flex min-h-10 items-center gap-2 rounded-md bg-theme-bg-secondary px-3 text-xs font-medium text-theme-text-primary transition-colors duration-150 hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
              title={i18n.t("app_error.copy_details")}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" weight="bold" />
                  {i18n.t("app_error.copied")}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  {i18n.t("app_error.copy_details")}
                </>
              )}
            </button>
          </div>
          <pre className="max-h-[60vh] w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-theme-border bg-theme-bg-secondary p-4 font-mono text-xs text-theme-text-secondary md:max-h-[70vh] md:p-6 md:text-sm">
            {error?.stack}
          </pre>
        </div>
      )}
      <div className="mt-4 flex w-full flex-col gap-3 md:w-auto md:flex-row md:gap-4">
        <button
          type="button"
          onClick={reload}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 md:w-auto"
        >
          <ArrowClockwise className="w-4 h-4" />
          {i18n.t("app_error.reload")}
        </button>
        <NavLink
          to="/"
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-theme-border bg-theme-bg-secondary px-4 text-sm font-medium text-theme-text-primary transition-colors duration-150 hover:bg-theme-sidebar-item-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 md:w-auto"
        >
          <House className="w-4 h-4" />
          {i18n.t("app_error.home")}
        </NavLink>
      </div>
    </div>
  );
}

export function RouteErrorFallback() {
  const error = useRouteError();
  return <ErrorBoundaryFallback error={error} />;
}
