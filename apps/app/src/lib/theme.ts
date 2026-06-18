/** Esquema de color efectivo que se pinta. */
export type Scheme = "light" | "dark";

/** Preferencia del usuario: seguir el sistema o forzar uno. */
export type ThemePreference = "system" | "light" | "dark";

export interface Palette {
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  badgeBg: string;
  badgeText: string;
  inputBorder: string;
}

const light: Palette = {
  bg: "#ffffff",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  primary: "#2563eb",
  primaryText: "#ffffff",
  badgeBg: "#f1f5f9",
  badgeText: "#334155",
  inputBorder: "#cbd5e1",
};

const dark: Palette = {
  bg: "#0b1120",
  card: "#111827",
  border: "#1f2937",
  text: "#e5e7eb",
  muted: "#94a3b8",
  primary: "#3b82f6",
  primaryText: "#ffffff",
  badgeBg: "#1f2937",
  badgeText: "#cbd5e1",
  inputBorder: "#374151",
};

export const PALETTES: Record<Scheme, Palette> = { light, dark };

/** Esquema efectivo dado lo que reporta el sistema y la preferencia del usuario. */
export function resolveScheme(
  systemScheme: Scheme | null | undefined,
  pref: ThemePreference,
): Scheme {
  if (pref === "light" || pref === "dark") return pref;
  return systemScheme ?? "light";
}

export function paletteFor(scheme: Scheme): Palette {
  return PALETTES[scheme];
}

/** Siguiente preferencia al pulsar el toggle: system → light → dark → system. */
export function nextPreference(pref: ThemePreference): ThemePreference {
  return pref === "system" ? "light" : pref === "light" ? "dark" : "system";
}

const ICON: Record<ThemePreference, string> = { system: "🌗", light: "☀️", dark: "🌙" };

export function themeIcon(pref: ThemePreference): string {
  return ICON[pref];
}
