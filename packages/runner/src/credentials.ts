import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RunnerCredential } from "@batuta/backend-supabase";

export type { RunnerCredential };

/** Ruta del archivo de credenciales del runner (configurable con BATUTA_HOME). */
export function defaultCredentialPath(): string {
  const home = process.env.BATUTA_HOME ?? join(homedir(), ".batuta");
  return join(home, "credentials.json");
}

/** Guarda la credencial del runner en disco (permisos 600). */
export async function saveCredential(
  credential: RunnerCredential,
  path: string = defaultCredentialPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(credential, null, 2), { encoding: "utf8", mode: 0o600 });
}

/** Carga la credencial del runner, o `null` si todavía no está emparejado. */
export async function loadCredential(
  path: string = defaultCredentialPath(),
): Promise<RunnerCredential | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RunnerCredential;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
