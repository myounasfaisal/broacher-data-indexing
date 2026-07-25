import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Appearance system — two independent axes, both persisted to localStorage
 * and both mirrored by the inline pre-paint script in index.html so neither
 * flashes the wrong value before React mounts.
 *
 *   1. THEME  — light / dark / system. Toggles the `.dark` class on <html>.
 *   2. ACCENT — teal / ember. Sets `data-accent` on <html>. Teal is the
 *      default and needs no attribute; ember writes `data-accent="ember"`,
 *      which index.css uses to override the --brand-* tokens. The two accents
 *      are equal citizens (DESIGN.md's Two Accents Rule).
 *
 * The axes are orthogonal: every accent defines correct values for BOTH
 * themes, so any of the four combinations renders correctly.
 */
type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";
type Accent = "teal" | "ember";

const STORAGE_KEY = "theme";
const ACCENT_KEY = "accent";
const ACCENTS: readonly Accent[] = ["teal", "ember"];

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: Resolved;
  setTheme: (t: Theme) => void;
  /** Flip between light and dark (sets an explicit choice). */
  toggle: () => void;
  accent: Accent;
  setAccent: (a: Accent) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const prefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

function resolve(theme: Theme): Resolved {
  if (theme === "system") return prefersDark() ? "dark" : "light";
  return theme;
}

/** Teal is the default; only ember is an explicit stored value. */
function applyAccent(a: Accent) {
  const el = document.documentElement;
  if (a === "ember") el.setAttribute("data-accent", "ember");
  else el.removeAttribute("data-accent");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<Resolved>(() =>
    resolve(theme),
  );
  const [accent, setAccentState] = useState<Accent>(() => {
    if (typeof window === "undefined") return "teal";
    const stored = localStorage.getItem(ACCENT_KEY) as Accent | null;
    return stored && ACCENTS.includes(stored) ? stored : "teal";
  });

  // Apply the resolved theme to <html> and keep it in sync with the choice.
  useEffect(() => {
    const r = resolve(theme);
    setResolvedTheme(r);
    document.documentElement.classList.toggle("dark", r === "dark");
  }, [theme]);

  // While on "system", follow OS changes live.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = prefersDark() ? "dark" : "light";
      setResolvedTheme(r);
      document.documentElement.classList.toggle("dark", r === "dark");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* storage unavailable — theme still applies for the session */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolve(theme) === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Keep <html data-accent> in sync with the choice.
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  const setAccent = useCallback((a: Accent) => {
    setAccentState(a);
    try {
      localStorage.setItem(ACCENT_KEY, a);
    } catch {
      /* storage unavailable — accent still applies for the session */
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggle, accent, setAccent }),
    [theme, resolvedTheme, setTheme, toggle, accent, setAccent],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
