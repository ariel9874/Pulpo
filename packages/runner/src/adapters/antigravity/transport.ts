import type { RequestPermission } from "../../agent-adapter.js";

/**
 * Transporte agnóstico para Antigravity: capa fina entre el CLI de Antigravity
 * (`agy`) y el adaptador. El adaptador solo conoce estos `AntigravityMessage`,
 * así que se prueba con un transporte simulado y la integración real con el CLI
 * vive aislada en `cli-transport.ts`. Mismo patrón que el adaptador de Claude.
 */
export type AntigravityMessage =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; tool: string; title: string }
  | { kind: "result"; outcome: "completed" | "failed" }
  | { kind: "error"; message: string };

export interface AntigravityRunOptions {
  /** Entrada del usuario: el primer elemento es el prompt; los siguientes, los
   *  `send_message`. Cada uno es un turno del agente. Termina al cerrarse. */
  input: AsyncIterable<string>;
  /** Directorio de trabajo donde corre Antigravity. */
  cwd: string;
  /** Se aborta para cancelar la ejecución. */
  signal: AbortSignal;
  /**
   * Pide permiso antes de una acción sensible. NOTA: el CLI headless de
   * Antigravity no expone un hook de permisos (auto-aprueba con `--yes`), así que
   * el transporte real no lo usa; se mantiene por uniformidad con el contrato.
   */
  requestPermission: RequestPermission;
}

export interface AntigravityTransport {
  /** Lanza Antigravity con el prompt y emite su actividad como `AntigravityMessage`. */
  run(options: AntigravityRunOptions): AsyncIterable<AntigravityMessage>;
}
