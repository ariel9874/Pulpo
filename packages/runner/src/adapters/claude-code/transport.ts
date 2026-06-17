/**
 * Transporte SDK-agnóstico para Claude Code: una capa fina entre el Claude Agent
 * SDK y el adaptador. El adaptador solo conoce estos `ClaudeMessage`, así que se
 * puede probar con un transporte simulado (sin gastar tokens) y la integración
 * real vive aislada en `sdk-transport.ts`.
 */
export type ClaudeMessage =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; tool: string; title: string }
  | { kind: "result"; outcome: "completed" | "failed" }
  | { kind: "error"; message: string };

import type { RequestPermission } from "../../agent-adapter.js";

export interface ClaudeRunOptions {
  /** Entrada del usuario: el primer elemento es el prompt; los siguientes,
   *  los `send_message` de la sesión en curso. Termina al cerrarse. */
  input: AsyncIterable<string>;
  /** Directorio de trabajo donde corre Claude. */
  cwd: string;
  /** Se aborta para cancelar la ejecución. */
  signal: AbortSignal;
  /** Pide permiso (bloqueante) antes de una acción sensible. */
  requestPermission: RequestPermission;
}

export interface ClaudeTransport {
  /** Lanza Claude con el prompt y emite su actividad como `ClaudeMessage`. */
  run(options: ClaudeRunOptions): AsyncIterable<ClaudeMessage>;
}
