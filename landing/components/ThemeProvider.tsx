"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

export type Theme = "light" | "dark";

type ThemeProviderState = {
  theme: Theme;
};

const ThemeContext = createContext<ThemeProviderState>({
  theme: "light",
});

export const ThemeProvider = ({ children }: { children?: ReactNode }) => {
  const [themeState, setThemeState] = useState<ThemeProviderState>({
    theme: "light",
  });

  useLayoutEffect(() => {
    const match = window.matchMedia("(prefers-color-scheme:dark)");

    function onChange(event: { matches: boolean }) {
      setThemeState((themeState) => {
        const targetTheme = event.matches ? "dark" : "light";

        if (themeState.theme === targetTheme) {
          return themeState;
        }

        return {
          ...themeState,
          theme: targetTheme,
        };
      });
    }

    onChange(match);

    match.addEventListener("change", onChange);
    return () => {
      match.removeEventListener("change", onChange);
    };
  }, []);

  return <ThemeContext value={themeState}>{children}</ThemeContext>;
};

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}
