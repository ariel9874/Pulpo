import { claimPairing } from "@batuta/backend-supabase";
import { normalizeDeviceCode } from "./device-code";
import { getSigningPublicKey } from "./signing-key";
import { supabase } from "./supabase";

export { normalizeDeviceCode };

/**
 * Reclama un código de emparejamiento como el usuario autenticado (crea la
 * máquina) y registra la clave pública de firma de este dispositivo, para que el
 * runner solo acepte comandos firmados por esta app.
 */
export async function claimDevice(rawCode: string): Promise<{ machineId: string }> {
  const code = normalizeDeviceCode(rawCode);
  if (code.length === 0) throw new Error("Introduce el código que muestra el runner.");
  const publicKey = await getSigningPublicKey();
  return claimPairing(supabase, code, publicKey);
}
