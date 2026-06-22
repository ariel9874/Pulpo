import { spawn } from "node:child_process";
import type { AgentModel } from "@pulpo/protocol";
import type {
  AntigravityMessage,
  AntigravityRunOptions,
  AntigravityTransport,
} from "./transport.js";

export interface AgyCliOptions {
  /** Binario del CLI de Antigravity. Por defecto `agy`. */
  bin?: string;
  /**
   * Auto-aprobar acciones (`--yes`). El CLI headless lo necesita para no
   * bloquearse en confirmaciones. ⚠️ Implica que NO hay gating de permisos por la
   * app: Antigravity ejecuta sus acciones sin pedir aprobación en Pulpo (límite
   * de la superficie CLI; ver SECURITY.md / README). Por seguridad, por defecto
   * está desactivado — actívalo a sabiendas para ejecución desatendida.
   */
  autoApprove?: boolean;
  /** Modelo opcional (`--model`). */
  model?: string;
}

/**
 * Transporte real: invoca el CLI de Antigravity (`agy --print`) en modo headless
 * y mapea su salida a `AntigravityMessage`.
 *
 * Verificado contra `agy --help` v1.0.10: `--print`/`-p` corre un prompt y emite
 * la respuesta en **texto plano** (no JSON), `--model` elige modelo, y la
 * auto-aprobación es `--dangerously-skip-permissions`. El print mode NO expone un
 * hook de permisos por herramienta: o se auto-aprueba o no se ejecuta (ver
 * SECURITY.md). Todo lo específico del CLI vive aislado aquí.
 */
export class AgyCliTransport implements AntigravityTransport {
  constructor(private readonly opts: AgyCliOptions = {}) {}

  async *run(options: AntigravityRunOptions): AsyncIterable<AntigravityMessage> {
    // Cada mensaje de entrada es un turno (el CLI headless es de un solo disparo).
    for await (const prompt of options.input) {
      if (options.signal.aborted) return;
      yield* this.runOnce(prompt, options);
      if (options.signal.aborted) return;
    }
  }

  private async *runOnce(
    prompt: string,
    options: AntigravityRunOptions,
  ): AsyncIterable<AntigravityMessage> {
    const bin = this.opts.bin ?? "agy";
    const args = ["--print", prompt];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.opts.autoApprove) args.push("--dangerously-skip-permissions");

    const child = spawn(bin, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const onAbort = (): void => void child.kill();
    options.signal.addEventListener("abort", onAbort);

    // El proceso termina por 'close' (salió) o 'error' (no se pudo lanzar, p. ej.
    // ENOENT si `agy` no está instalado). Escuchar 'error' es CRÍTICO: sin un
    // listener, Node lanza el evento como excepción no manejada y tumba el runner.
    const done = new Promise<{ code: number | null; error: NodeJS.ErrnoException | null }>(
      (resolve) => {
        child.on("error", (error) => resolve({ code: null, error }));
        child.on("close", (code) => resolve({ code, error: null }));
      },
    );

    // `--print` emite la respuesta en texto plano por stdout; la acumulamos y la
    // entregamos como un único `text` al terminar (el modo es de un solo disparo).
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    try {
      const { code, error } = await done;
      if (error) {
        yield { kind: "error", message: spawnErrorMessage(bin, error) };
        return;
      }
      if (options.signal.aborted) return;
      const text = stdout.trim();
      if (code === 0) {
        if (text) yield { kind: "text", text };
        yield { kind: "result", outcome: "completed" };
      } else {
        if (text) yield { kind: "text", text };
        yield { kind: "error", message: stderr.trim() || `agy salió con código ${code}` };
      }
    } finally {
      options.signal.removeEventListener("abort", onAbort);
    }
  }
}

/** Mensaje claro cuando no se pudo lanzar el CLI (típicamente, no está instalado). */
function spawnErrorMessage(bin: string, error: NodeJS.ErrnoException): string {
  if (error.code === "ENOENT") {
    return `No se encontró el CLI de Antigravity ("${bin}"). Instálalo (o usa el agente claude-code); el agente "antigravity" no está disponible en esta PC.`;
  }
  return `No se pudo lanzar "${bin}": ${error.message}`;
}

export interface AgyDiscovery {
  /** ¿`agy` está instalado y responde? */
  available: boolean;
  /** Catálogo de modelos (best-effort vía `agy models`; [] si falla o no logueado). */
  models: AgentModel[];
}

/**
 * Descubre el estado de `agy` en esta máquina: si está instalado (`--version`) y
 * su catálogo de modelos (`agy models`). Defensivo: timeouts y nunca lanza, para
 * no bloquear el arranque del runner. `agy models` requiere login de Google, así
 * que sin sesión devuelve modelos vacíos (la app usará el modelo por defecto).
 */
export async function discoverAgy(bin = "agy"): Promise<AgyDiscovery> {
  const version = await runAgyCapture(bin, ["--version"], 4_000);
  if (version === null) return { available: false, models: [] };
  const list = await runAgyCapture(bin, ["models"], 6_000);
  return { available: true, models: list ? parseAgyModels(list) : [] };
}

/** Corre `agy <args>` y devuelve su stdout si salió con 0; `null` si falla/expira. */
function runAgyCapture(bin: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
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

/**
 * Parser best-effort de `agy models` (formato no documentado de forma estable):
 * una línea por modelo, descartando encabezados/separadores. Ajustar al verificar
 * la salida real con sesión iniciada.
 */
function parseAgyModels(text: string): AgentModel[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^(usage|available|models?)\b/i.test(l) && !/^[-=*]/.test(l))
    .map((id) => ({ id, label: id }));
}
