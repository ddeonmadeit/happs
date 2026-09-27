import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MAP_STYLES } from "@/lib/constants";

export type ColorScheme = "earth" | "warm" | "jaded";
export type ThemeMode = "light" | "dark";

export const COLOR_SCHEMES: { id: ColorScheme; label: string; light: string; dark: string; highlight: string }[] = [
  { id: "earth", label: "Earth", light: "#EBE3D3", dark: "#4E3727", highlight: "#223D22" },
  { id: "warm", label: "Warm", light: "#FFF0E6", dark: "#261207", highlight: "#AB570E" },
  { id: "jaded", label: "Jaded", light: "#FFF0E6", dark: "#212121", highlight: "#D7E5C6" },
];

type ThemeContextValue = {
  colorScheme: ColorScheme;
  mode: ThemeMode;
  setColorScheme: (scheme: ColorScheme) => void;
  setMode: (mode: ThemeMode) => void;
  mapStyle: string;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(() =>
    read("happ-color-scheme", ["earth", "warm", "jaded"] as const, "warm"),
  );
  const [mode, setModeState] = useState<ThemeMode>(() => read("happ-theme-mode", ["light", "dark"] as const, "dark"));

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-earth", "theme-warm", "theme-jaded", "dark");
    root.classList.add(`theme-${colorScheme}`);
    if (mode === "dark") root.classList.add("dark");
    root.style.colorScheme = mode;

    // Keep the browser / status bar colour in sync with the theme.
    const bg = getComputedStyle(root).getPropertyValue("--background").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (bg && meta) meta.setAttribute("content", `hsl(${bg.split(" ").join(", ")})`);
  }, [colorScheme, mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colorScheme,
      mode,
      setColorScheme: (scheme) => {
        setColorSchemeState(scheme);
        write("happ-color-scheme", scheme);
      },
      setMode: (next) => {
        setModeState(next);
        write("happ-theme-mode", next);
      },
      mapStyle: MAP_STYLES[mode],
    }),
    [colorScheme, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
