import { claimPairing } from "@batuta/backend-supabase";
import { normalizeDeviceCode } from "./device-code";
import { supabase } from "./supabase";

export { normalizeDeviceCode };

/** Reclama un código de emparejamiento como el usuario autenticado (crea la máquina). */
export async function claimDevice(rawCode: string): Promise<{ machineId: string }> {
  const code = normalizeDeviceCode(rawCode);
  if (code.length === 0) throw new Error("Introduce el código que muestra el runner.");
  return claimPairing(supabase, code);
}
