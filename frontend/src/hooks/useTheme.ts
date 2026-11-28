import { REFETCH_LOGO_EVENT } from "@/LogoContext";
import { useState, useEffect, useRef } from "react";

const availableThemes = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

type ThemeOption = keyof typeof availableThemes;

export function useTheme() {
  const hasAppliedInitialTheme = useRef(false);
  const [theme, _setTheme] = useState<ThemeOption>(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "default") return "dark"; // migrate legacy value
    return stored === "dark" || stored === "light" ? stored : "system";
  });

  const [systemTheme, setSystemTheme] = useState(() =>
    window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark"
  );

  // Listen for OS level theme changes
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) =>
      setSystemTheme(e.matches ? "light" : "dark");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.body.classList.toggle("light", resolvedTheme === "light");
    localStorage.setItem("theme", theme);
    if (hasAppliedInitialTheme.current) {
      window.dispatchEvent(new Event(REFETCH_LOGO_EVENT));
    } else {
      hasAppliedInitialTheme.current = true;
    }
  }, [resolvedTheme, theme]);

  // In development, attach keybind combinations to toggle theme
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    function toggleOnKeybind(e: KeyboardEvent) {
      if (e.metaKey && e.key === ".") {
        e.preventDefault();
        _setTheme((prev) => (prev === "light" ? "dark" : "light"));
      }
    }
    document.addEventListener("keydown", toggleOnKeybind);
    return () => document.removeEventListener("keydown", toggleOnKeybind);
  }, []);

  /**
   * Sets the theme of the application and runs any
   * other necessary side effects
   * @param {ThemeOption} newTheme The new theme to set
   */
  function setTheme(newTheme: ThemeOption) {
    _setTheme(newTheme);
  }

  return {
    theme,
    setTheme,
    availableThemes,
    isLight: resolvedTheme === "light",
  };
}
