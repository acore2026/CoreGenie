import { type PropsWithChildren, createContext, useContext } from "react";
import { useTheme } from "./hooks/useTheme";

const ThemeContext = createContext<ReturnType<typeof useTheme> | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const themeValue = useTheme();

  return (
    <ThemeContext.Provider value={themeValue}>{children}</ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useThemeContext requires ThemeProvider");
  return value;
}
