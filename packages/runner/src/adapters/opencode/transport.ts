import type { RequestPermission } from "../../agent-adapter.js";

/**
 * Transporte agnóstico para opencode: capa fina entre el servidor/SDK de opencode
 * y el adaptador. El adaptador solo conoce estos `OpencodeMessage`, así que se
 * prueba con un transporte simulado y la integración real (servidor + SDK) vive
 * aislada en `sdk-transport.ts`. Mismo patrón que claude-code/antigravity.
 */
export type OpencodeMessage =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; tool: string; title: string }
  | { kind: "result"; outcome: "completed" | "failed" }
  | { kind: "error"; message: string };

export interface OpencodeRunOptions {
  /** Entrada del usuario: el primer elemento es el prompt; los siguientes, los
   *  `send_message` de la sesión en curso. Termina al cerrarse. */
  input: AsyncIterable<string>;
  /** Directorio de trabajo donde corre opencode (va como `query.directory`). */
  cwd: string;
  /** Se aborta para cancelar la ejecución. */
  signal: AbortSignal;
  /** Pide permiso (bloqueante) antes de una acción sensible. opencode SÍ expone
   *  gating de permisos vía su evento `permission.updated`. */
  requestPermission: RequestPermission;
}

export interface OpencodeTransport {
  /** Lanza opencode con el prompt y emite su actividad como `OpencodeMessage`. */
  run(options: OpencodeRunOptions): AsyncIterable<OpencodeMessage>;
}
