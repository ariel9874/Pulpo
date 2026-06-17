import { PairingClient, type RunnerCredential } from "@batuta/backend-supabase";
import { defaultCredentialPath, saveCredential } from "./credentials.js";

export interface PairOptions {
  url: string;
  anonKey: string;
  /** Dónde guardar la credencial. Por defecto, la ruta estándar del runner. */
  credentialPath?: string;
  /** Se llama con el código a mostrar al usuario. Por defecto, lo imprime. */
  onCode?: (deviceCode: string) => void;
  intervalMs?: number;
  timeoutMs?: number;
}

function printCode(deviceCode: string): void {
  console.log("\n  Empareja esta PC: abre la app de Batuta e introduce el código\n");
  console.log(`      ┌────────────┐`);
  console.log(`      │  ${deviceCode}  │`);
  console.log(`      └────────────┘\n`);
  console.log("  Esperando a que lo confirmes en la app…");
}

/**
 * Empareja el runner: pide un código, lo muestra, espera a que el usuario lo
 * reclame en la app y guarda la credencial resultante en disco.
 */
export async function pair(opts: PairOptions): Promise<RunnerCredential> {
  const client = new PairingClient(opts.url, opts.anonKey);
  const start = await client.start();
  (opts.onCode ?? printCode)(start.deviceCode);
  const credential = await client.waitForClaim(start, {
    intervalMs: opts.intervalMs,
    timeoutMs: opts.timeoutMs,
  });
  await saveCredential(credential, opts.credentialPath ?? defaultCredentialPath());
  return credential;
}
