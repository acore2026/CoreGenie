import { formatDateTimeAsMoment } from "@/utils/directories";
import { formatDuration, numberWithCommas } from "@/utils/numbers";
import React, { useEffect, useState, useContext } from "react";
import { isMobile } from "react-device-detect";
import type { ChatMetrics as Metrics } from "@coregenie/contracts";
const MetricsContext = React.createContext<{
  showMetricsAutomatically: boolean;
  setShowMetricsAutomatically: (show: boolean) => void;
} | null>(null);
const SHOW_METRICS_KEY = "anythingllm_show_chat_metrics";
const SHOW_METRICS_EVENT = "anythingllm_show_metrics_change";

/**
 * Format the output TPS to a string
 */
function formatTps(outputTps: number) {
  try {
    return outputTps < 1000
      ? outputTps.toFixed(2)
      : numberWithCommas(outputTps.toFixed(0));
  } catch {
    return "";
  }
}

/**
 * Get the show metrics setting from localStorage `anythingllm_show_chat_metrics` key
 */
function getAutoShowMetrics() {
  return window?.localStorage?.getItem(SHOW_METRICS_KEY) === "true";
}

/**
 * Build the metrics string for a given metrics object
 * - Model name
 * - Duration and output TPS
 * - Timestamp
 */
function buildMetricsString(metrics: Metrics) {
  return [
    metrics?.model ? metrics.model : "",
    `${formatDuration(metrics.duration ?? 0)} (${formatTps(metrics.outputTps ?? 0)} tok/s)`,
    metrics?.timestamp
      ? formatDateTimeAsMoment(metrics.timestamp, "MMM D, h:mm A")
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Toggle the show metrics setting in localStorage `anythingllm_show_chat_metrics` key
 */
function toggleAutoShowMetrics() {
  const currentValue = getAutoShowMetrics() || false;
  window?.localStorage?.setItem(SHOW_METRICS_KEY, String(!currentValue));
  window.dispatchEvent(
    new CustomEvent(SHOW_METRICS_EVENT, {
      detail: { showMetricsAutomatically: !currentValue },
    })
  );
  return !currentValue;
}

/**
 * Provider for the metrics context that controls the visibility of the metrics
 * per-chat based on the user's preference.
 */
export function MetricsProvider({ children }: React.PropsWithChildren) {
  const [showMetricsAutomatically, setShowMetricsAutomatically] =
    useState(getAutoShowMetrics());

  useEffect(() => {
    function handleShowingMetricsEvent(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      if (!e?.detail?.hasOwnProperty("showMetricsAutomatically")) return;
      setShowMetricsAutomatically(e.detail.showMetricsAutomatically);
    }
    window.addEventListener(SHOW_METRICS_EVENT, handleShowingMetricsEvent);
    return () =>
      window.removeEventListener(SHOW_METRICS_EVENT, handleShowingMetricsEvent);
  }, []);

  return (
    <MetricsContext.Provider
      value={{ showMetricsAutomatically, setShowMetricsAutomatically }}
    >
      {children}
    </MetricsContext.Provider>
  );
}

/**
 * Render the metrics for a given chat, if available
 */
export default function RenderMetrics({ metrics = {} }: { metrics?: Metrics }) {
  // Inherit the showMetricsAutomatically state from the MetricsProvider so the state is shared across all chats
  const context = useContext(MetricsContext);
  if (!context) return null;
  const { showMetricsAutomatically, setShowMetricsAutomatically } = context;
  if (!metrics?.duration || !metrics?.outputTps || isMobile) return null;

  return (
    <button
      type="button"
      onClick={() => setShowMetricsAutomatically(toggleAutoShowMetrics())}
      data-tooltip-id="metrics-visibility"
      data-tooltip-content={
        showMetricsAutomatically
          ? "Click to only show metrics when hovering"
          : "Click to show metrics as soon as they are available"
      }
      className={`border-none flex md:justify-end items-center gap-x-[8px] -ml-7 ${showMetricsAutomatically ? "opacity-100" : "opacity-0"} md:group-hover:opacity-100 transition-all duration-300`}
    >
      <p className="cursor-pointer text-xs font-mono text-zinc-400 light:text-slate-500">
        {buildMetricsString(metrics)}
      </p>
    </button>
  );
}
