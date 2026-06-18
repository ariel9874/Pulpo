import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Palette } from "./theme";
import { useTheme, type ThemeState } from "./useTheme";

const ThemeContext = createContext<ThemeState | null>(null);

/** Provee el tema (claro/oscuro + toggle) a toda la app desde una sola fuente. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext debe usarse dentro de <ThemeProvider>");
  return ctx;
}

/** Atajo: estilos derivados de la paleta actual, memoizados por paleta. */
export function useThemedStyles<T>(factory: (palette: Palette) => T): T {
  const { palette } = useThemeContext();
  return useMemo(() => factory(palette), [palette, factory]);
}
