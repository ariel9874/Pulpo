import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import {
  nextPreference,
  paletteFor,
  resolveScheme,
  type Palette,
  type Scheme,
  type ThemePreference,
} from "./theme";

const STORAGE_KEY = "pulpo.theme";

export interface ThemeState {
  scheme: Scheme;
  palette: Palette;
  preference: ThemePreference;
  /** Cicla la preferencia (system → light → dark → …) y la persiste. */
  cycle: () => void;
}

/** Tema efectivo: sigue al sistema salvo que el usuario fije uno (persistido). */
export function useTheme(): ThemeState {
  const system = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (active && (stored === "system" || stored === "light" || stored === "dark")) {
        setPreference(stored);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const cycle = (): void => {
    setPreference((prev) => {
      const next = nextPreference(prev);
      void AsyncStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  };

  const scheme = resolveScheme(system, preference);
  return { scheme, palette: paletteFor(scheme), preference, cycle };
}
