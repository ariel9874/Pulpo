import { spawn } from "node:child_process";
import type { AgentModel } from "@batuta/protocol";

export interface OpencodeDiscovery {
  /** ¿`opencode` está instalado y responde? */
  available: boolean;
  /** Catálogo de modelos (`opencode models`, headless). [] si falla o sin proveedor. */
  models: AgentModel[];
}

/**
 * Descubre el estado de opencode en esta máquina: si está instalado (`--version`)
 * y su catálogo de modelos (`opencode models`). Defensivo: timeouts y nunca lanza,
 * para no bloquear el arranque del runner. El catálogo se llena según los
 * proveedores configurados en opencode (vacío si no hay ninguno).
 */
export async function discoverOpencode(bin = "opencode"): Promise<OpencodeDiscovery> {
  const version = await runCapture(bin, ["--version"], 5_000);
  if (version === null) return { available: false, models: [] };
  const list = await runCapture(bin, ["models"], 8_000);
  return { available: true, models: list ? parseModels(list) : [] };
}

/**
 * Parser de `opencode models`: una línea `provider/model` por modelo. Filtra
 * cualquier ruido (encabezados, ANSI, vacíos) quedándose solo con `provider/model`.
 */
export function parseModels(text: string): AgentModel[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+\/[\w.:-]+$/.test(l))
    .map((id) => ({ id, label: id }));
}

/** Corre `opencode <args>` y devuelve su stdout si salió con 0; `null` si falla/expira. */
function runCapture(bin: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    // shell en Windows: el lanzador de npm es `opencode.cmd`/`.ps1`, que CreateProcess
    // no ejecuta directo. Los args son fijos (sin entrada de usuario): sin riesgo.
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (out += chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
  });
}
