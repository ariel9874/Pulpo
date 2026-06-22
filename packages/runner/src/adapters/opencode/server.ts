import { createOpencode } from "@opencode-ai/sdk";

type OpencodeClient = Awaited<ReturnType<typeof createOpencode>>["client"];

/**
 * Servidor opencode compartido por el runner. `createOpencode()` levanta el
 * servidor headless y devuelve un cliente; lo creamos una sola vez (lazy) y lo
 * reutilizamos en todas las tareas opencode de esta máquina. El servidor escucha
 * en localhost (lo gestiona el SDK).
 */
let started: Promise<{ client: OpencodeClient; close: () => void }> | undefined;

/** Cliente del servidor opencode compartido (lo arranca en la primera llamada). */
export async function opencodeClient(): Promise<OpencodeClient> {
  started ??= createOpencode().then((r) => ({ client: r.client, close: r.server.close }));
  return (await started).client;
}

/** Cierra el servidor opencode (al apagar el runner). Idempotente. */
export async function disposeOpencodeServer(): Promise<void> {
  const current = started;
  started = undefined;
  if (!current) return;
  try {
    (await current).close();
  } catch {
    // El servidor ya podría estar caído; no es un error que deba propagarse.
  }
}
