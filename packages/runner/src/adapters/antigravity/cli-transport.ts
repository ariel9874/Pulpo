import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
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
   * app: Antigravity ejecuta sus acciones sin pedir aprobación en Batuta (límite
   * de la superficie CLI; ver SECURITY.md / README). Por seguridad, por defecto
   * está desactivado — actívalo a sabiendas para ejecución desatendida.
   */
  autoApprove?: boolean;
  /** Modelo opcional (`--model`). */
  model?: string;
}

/**
 * Transporte real: invoca el CLI de Antigravity (`agy`) en modo headless con
 * salida JSON y mapea su actividad a `AntigravityMessage`.
 *
 * ⚠️ El contrato EXACTO del CLI (nombre del binario, flags y forma del JSON)
 * varía por versión y no está documentado de forma estable; los valores aquí son
 * el mejor esfuerzo a partir de la documentación pública y DEBEN verificarse
 * contra `agy --help` de la versión instalada. Todo lo específico del CLI está
 * aislado en este archivo: el adaptador y sus tests no dependen de él.
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
    const args = ["-p", prompt, "--output-format", "json", "--no-color"];
    if (this.opts.autoApprove) args.push("--yes");
    if (this.opts.model) args.push("--model", this.opts.model);

    const child = spawn(bin, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const onAbort = (): void => void child.kill();
    options.signal.addEventListener("abort", onAbort);

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    let sawResult = false;
    try {
      const rl = createInterface({ input: child.stdout });
      for await (const line of rl) {
        const message = mapCliLine(line);
        if (!message) continue;
        if (message.kind === "result") sawResult = true;
        yield message;
      }
      const code = await new Promise<number>((resolve) =>
        child.on("close", (c) => resolve(c ?? 0)),
      );
      if (!sawResult && code !== 0 && !options.signal.aborted) {
        yield { kind: "error", message: stderr.trim() || `agy salió con código ${code}` };
      }
    } finally {
      options.signal.removeEventListener("abort", onAbort);
    }
  }
}

interface CliEvent {
  type?: string;
  role?: string;
  text?: string;
  message?: string;
  tool?: string;
  name?: string;
  title?: string;
  status?: string;
}

/**
 * Mapea una línea de salida del CLI (NDJSON) a un `AntigravityMessage`, o `null`
 * si no es relevante o no parsea. Defensivo a propósito: las claves exactas del
 * JSON de `agy` se ajustarán al verificarlas con la versión instalada.
 */
export function mapCliLine(line: string): AntigravityMessage | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let event: CliEvent;
  try {
    event = JSON.parse(trimmed) as CliEvent;
  } catch {
    return null;
  }
  const type = (event.type ?? event.role ?? "").toLowerCase();
  const text = event.text ?? event.message ?? "";
  if (type.includes("error")) return { kind: "error", message: text || "error de Antigravity" };
  if (type.includes("think") || type.includes("reason")) return { kind: "thinking", text };
  if (type.includes("tool")) {
    const tool = event.tool ?? event.name ?? "tool";
    return { kind: "tool_use", tool, title: event.title ?? tool };
  }
  if (type.includes("result") || type.includes("done") || type.includes("final")) {
    const ok = (event.status ?? "").toLowerCase();
    return { kind: "result", outcome: ok === "failed" || ok === "error" ? "failed" : "completed" };
  }
  if (text) return { kind: "text", text };
  return null;
}
