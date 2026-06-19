import { claimPairing } from "@batuta/backend-supabase";
import { normalizeDeviceCode } from "./device-code";
import { getBoxPublicKey } from "./enc-key";
import { getSigningPublicKey } from "./signing-key";
import { supabase } from "./supabase";

export { normalizeDeviceCode };

/**
 * Reclama un código de emparejamiento como el usuario autenticado (crea la
 * máquina) y registra las claves públicas de este dispositivo: la de FIRMA (el
 * runner solo acepta comandos firmados por esta app) y la de CIFRADO (el runner
 * cifra los diffs hacia ella; el backend no los ve en claro).
 */
export async function claimDevice(rawCode: string): Promise<{ machineId: string }> {
  const code = normalizeDeviceCode(rawCode);
  if (code.length === 0) throw new Error("Introduce el código que muestra el runner.");
  const [signerPublicKey, boxPublicKey] = await Promise.all([
    getSigningPublicKey(),
    getBoxPublicKey(),
  ]);
  return claimPairing(supabase, code, signerPublicKey, boxPublicKey);
}
