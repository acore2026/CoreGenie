import React, { Suspense, useDeferredValue, useEffect } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { AuthProvider } from "@/AuthContext";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import i18n from "./i18n";

import { PfpProvider } from "./PfpContext";
import { LogoProvider } from "./LogoContext";
import { FullScreenLoader } from "./components/Preloader";
import { ThemeProvider } from "./ThemeContext";
import { PWAModeProvider } from "./PWAContext";
import KeyboardShortcutsHelp from "@/components/KeyboardShortcutsHelp";
import ImageLightbox from "@/components/ImageLightbox";
import { ErrorBoundary } from "react-error-boundary";
import ErrorBoundaryFallback from "./components/ErrorBoundaryFallback";
import { SETTINGS_RETURN_PATH } from "@/utils/constants";

export default function App() {
  const location = useLocation();

  useEffect(() => {
    const isChatSurface =
      location.pathname === "/" ||
      /^\/workspace\/[^/]+(?:\/t\/[^/]+)?$/.test(location.pathname);
    if (!isChatSurface) return;

    sessionStorage.setItem(
      SETTINGS_RETURN_PATH,
      `${location.pathname}${location.search}${location.hash}`
    );
  }, [location]);

  return (
    <ErrorBoundary
      FallbackComponent={ErrorBoundaryFallback}
      onError={console.error}
      resetKeys={[location.pathname]}
    >
      <ThemeProvider>
        <PWAModeProvider>
          <AuthProvider>
            <LogoProvider>
              <PfpProvider>
                <I18nextProvider i18n={i18n}>
                  <Suspense fallback={<FullScreenLoader />}>
                    <StableOutlet />
                  </Suspense>
                  <ToastContainer />
                  <KeyboardShortcutsHelp />
                  <ImageLightbox />
                </I18nextProvider>
              </PfpProvider>
            </LogoProvider>
          </AuthProvider>
        </PWAModeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function StableOutlet() {
  const outlet = useOutlet();
  const deferredOutlet = useDeferredValue(outlet);
  const transitioning = outlet !== deferredOutlet;

  return (
    <>
      {deferredOutlet}
      {transitioning && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[999999] h-[2px] overflow-hidden bg-cyan-950/30"
          role="progressbar"
          aria-label="Loading page"
        >
          <div className="h-full w-1/3 animate-pulse bg-cyan-400" />
        </div>
      )}
    </>
  );
}
