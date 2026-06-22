import type {
  AgentCapability,
  AgentType,
  DistributiveOmit,
  Event,
  Session,
} from "@pulpo/protocol";

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

/** Petición de permiso que el agente hace antes de una acción sensible. */
export interface PermissionRequest {
  tool: string;
  title: string;
  /** Diff/resumen de lo que haría (texto). */
  diff?: string;
}
export type PermissionDecision = "allow" | "deny";
/** Pide permiso y se bloquea hasta que el usuario decide (o expira → deny). */
export type RequestPermission = (request: PermissionRequest) => Promise<PermissionDecision>;

export interface StartParams {
  session: Session;
  prompt: string;
  emit: EmitFn;
  requestPermission: RequestPermission;
}

/**
 * Contrato para enchufar cualquier agente (echo, Claude Code, Antigravity…).
 * Añadir un agente = implementar este contrato. El runner se encarga del resto.
 */
export interface AgentAdapter {
  readonly agentType: AgentType;
  /** Arranca una sesión del agente y devuelve su handle para comandos. */
  start(params: StartParams): Promise<AgentSession>;
  /**
   * Capacidades de este agente EN ESTA MÁQUINA: si está instalado/usable, su
   * catálogo de modelos, y qué soporta (effort, permisos, uso). El runner las
   * publica; la app las lee para adaptar la UI. Debe ser defensiva y no lanzar.
   */
  capabilities(): Promise<AgentCapability>;
}
