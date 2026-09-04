import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  WifiSlash,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import usePolling from "@/hooks/usePolling";
import { API_BASE } from "@/utils/constants";
import {
  NETWORK_AUTH_ATTEMPT_KEY,
  NETWORK_AUTH_RETURN_URL_KEY,
  NETWORK_FAILURE_THRESHOLD,
  NETWORK_PROBE_INTERVAL_MS,
  NETWORK_PROBE_STATUS,
  buildNetworkAuthUrl,
  isWithinNetworkAuthCooldown,
  probeNetworkSession,
  removeNetworkAuthParam,
  resolveNetworkAuthReturnUrl,
} from "@/utils/networkAuth";

const NOTICE = Object.freeze({
  offline: "offline",
  unavailable: "unavailable",
});

export default function NetworkAuthGuard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState(null);
  const [checking, setChecking] = useState(false);
  const failureCount = useRef(0);
  const pendingProbe = useRef(null);
  const redirecting = useRef(false);
  const mounted = useRef(true);

  const clearAuthNavigationState = useCallback(() => {
    const storedReturnUrl = sessionStorage.getItem(NETWORK_AUTH_RETURN_URL_KEY);
    const lastAttemptAt = sessionStorage.getItem(NETWORK_AUTH_ATTEMPT_KEY);
    const returnUrl = resolveNetworkAuthReturnUrl({
      currentHref: window.location.href,
      storedReturnUrl,
      lastAttemptAt,
    });

    sessionStorage.removeItem(NETWORK_AUTH_ATTEMPT_KEY);
    sessionStorage.removeItem(NETWORK_AUTH_RETURN_URL_KEY);
    if (!returnUrl) return;

    const parsedCleanUrl = new URL(returnUrl);
    navigate(
      `${parsedCleanUrl.pathname}${parsedCleanUrl.search}${parsedCleanUrl.hash}`,
      { replace: true }
    );
  }, [navigate]);

  const goToNetworkAuth = useCallback((ignoreCooldown = false) => {
    if (redirecting.current) return;

    const now = Date.now();
    const lastAttemptAt = sessionStorage.getItem(NETWORK_AUTH_ATTEMPT_KEY);
    if (!ignoreCooldown && isWithinNetworkAuthCooldown(lastAttemptAt, now)) {
      setNotice(navigator.onLine ? NOTICE.unavailable : NOTICE.offline);
      return;
    }

    redirecting.current = true;
    const returnUrl = removeNetworkAuthParam(window.location.href);
    sessionStorage.setItem(NETWORK_AUTH_RETURN_URL_KEY, returnUrl);
    sessionStorage.setItem(NETWORK_AUTH_ATTEMPT_KEY, String(now));
    window.location.assign(buildNetworkAuthUrl(returnUrl, now));
  }, []);

  const checkNetwork = useCallback(() => {
    if (pendingProbe.current || redirecting.current) {
      return pendingProbe.current;
    }

    if (mounted.current) setChecking(true);
    const probe = probeNetworkSession({
      fetchFn: window.fetch.bind(window),
      endpoint: `${API_BASE.replace(/\/$/, "")}/ping`,
    })
      .then((result) => {
        if (!mounted.current) return result;

        if (result.status === NETWORK_PROBE_STATUS.portal) {
          goToNetworkAuth();
          return result;
        }

        if (result.status === NETWORK_PROBE_STATUS.healthy) {
          failureCount.current = 0;
          setNotice(null);
          clearAuthNavigationState();
          return result;
        }

        failureCount.current += 1;
        if (
          !navigator.onLine ||
          failureCount.current >= NETWORK_FAILURE_THRESHOLD
        ) {
          setNotice(navigator.onLine ? NOTICE.unavailable : NOTICE.offline);
        }
        return result;
      })
      .finally(() => {
        if (mounted.current) setChecking(false);
        if (pendingProbe.current === probe) pendingProbe.current = null;
      });

    pendingProbe.current = probe;
    return probe;
  }, [clearAuthNavigationState, goToNetworkAuth]);

  useEffect(() => {
    mounted.current = true;
    checkNetwork();

    const handleOnline = () => checkNetwork();
    const handleFocus = () => {
      if (document.visibilityState === "visible") checkNetwork();
    };
    const handleOffline = () => {
      failureCount.current = NETWORK_FAILURE_THRESHOLD;
      setNotice(NOTICE.offline);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("offline", handleOffline);

    return () => {
      mounted.current = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkNetwork]);

  usePolling(checkNetwork, NETWORK_PROBE_INTERVAL_MS);

  if (!notice) return null;

  const isOffline = notice === NOTICE.offline;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[999998] flex justify-center px-3 sm:top-4 sm:px-4">
      <section
        className="pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-amber-300/20 bg-theme-bg-primary/95 px-3 py-3 text-theme-text-primary backdrop-blur-md light:border-amber-500/25 light:bg-white/95 sm:flex-row sm:items-center sm:gap-4 sm:px-4"
        role="alert"
        aria-live="polite"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300/20 bg-amber-300/[0.08] text-amber-300 light:border-amber-500/20 light:bg-amber-50 light:text-amber-700">
          <WifiSlash size={19} weight="bold" aria-hidden="true" />
        </span>
        <p className="m-0 min-w-0 flex-1 text-sm font-medium leading-5 text-pretty">
          {t(`networkAuth.${notice}`)}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {!isOffline && (
            <button
              type="button"
              onClick={() => goToNetworkAuth(true)}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-300/25 bg-amber-300/[0.1] px-3 text-xs font-semibold text-amber-200 outline-none transition-[background-color,transform] duration-150 hover:bg-amber-300/[0.16] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-amber-300/60 light:border-amber-500/25 light:bg-amber-50 light:text-amber-800 light:hover:bg-amber-100 sm:flex-none"
            >
              <ArrowSquareOut size={15} aria-hidden="true" />
              {t("networkAuth.open")}
            </button>
          )}
          <button
            type="button"
            onClick={checkNetwork}
            disabled={checking}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-semibold text-theme-text-secondary outline-none transition-[background-color,transform] duration-150 hover:bg-white/[0.05] hover:text-theme-text-primary active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-wait disabled:opacity-50 light:border-slate-200 light:hover:bg-slate-100 sm:flex-none"
          >
            <ArrowClockwise
              size={15}
              className={checking ? "motion-safe:animate-spin" : ""}
              aria-hidden="true"
            />
            {t(checking ? "networkAuth.checking" : "networkAuth.retry")}
          </button>
        </div>
      </section>
    </div>
  );
}
