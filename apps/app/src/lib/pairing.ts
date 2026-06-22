import { claimPairing } from "@pulpo/backend-supabase";
import { normalizeDeviceCode } from "./device-code";
import { getBoxPublicKey } from "./enc-key";
import { setRunnerBoxPublic } from "./runner-keys";
import { getSigningPublicKey } from "./signing-key";
import { supabase } from "./supabase";

export { normalizeDeviceCode };

/**
 * Reclama un código de emparejamiento como el usuario autenticado (crea la
 * máquina) y registra las claves públicas de este dispositivo: la de FIRMA (el
 * runner solo acepta comandos firmados por esta app) y la de CIFRADO (el runner
 * cifra los diffs hacia ella). Además ancla la clave de cifrado del runner para
 * autenticar los diffs (e2e mutuo).
 */
export async function claimDevice(rawCode: string): Promise<{ machineId: string }> {
  const code = normalizeDeviceCode(rawCode);
  if (code.length === 0) throw new Error("Introduce el código que muestra el runner.");
  const [signerPublicKey, boxPublicKey] = await Promise.all([
    getSigningPublicKey(),
    getBoxPublicKey(),
  ]);
  const { machineId, runnerBoxPublicKey } = await claimPairing(
    supabase,
    code,
    signerPublicKey,
    boxPublicKey,
  );
  if (runnerBoxPublicKey) await setRunnerBoxPublic(machineId, runnerBoxPublicKey);
  return { machineId };
}
