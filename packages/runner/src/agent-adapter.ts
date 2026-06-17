import type { AgentType, DistributiveOmit, Event, Session } from "@batuta/protocol";

/**
 * Un evento tal cual lo emite un adaptador: sin el envelope que pone el runner
 * (`id`/`ts`/`protocolVersion`/`sessionId`). El runner los completa al persistir.
 */
export type AgentEvent = DistributiveOmit<Event, "id" | "ts" | "protocolVersion" | "sessionId">;

/** Emite un evento del agente (el runner lo persiste vía `appendEvent`). */
export type EmitFn = (event: AgentEvent) => Promise<void>;

/** Una sesión de agente viva: el runner le pasa los comandos entrantes. */
export interface AgentSession {
  /** Mensaje del usuario hacia el agente. */
  sendMessage(text: string): Promise<void>;
  /** Cancela la tarea en curso. */
  cancel(): Promise<void>;
  /** Limpieza al cerrar (matar procesos, etc.). */
  dispose(): Promise<void>;
}

export interface StartParams {
  session: Session;
  prompt: string;
  emit: EmitFn;
}

/**
 * Contrato para enchufar cualquier agente (echo, Claude Code, Antigravity…).
 * Añadir un agente = implementar este contrato. El runner se encarga del resto.
 */
export interface AgentAdapter {
  readonly agentType: AgentType;
  /** Arranca una sesión del agente y devuelve su handle para comandos. */
  start(params: StartParams): Promise<AgentSession>;
}
