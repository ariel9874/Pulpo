import type { Payload } from "./common.js";
import type { Command } from "./commands.js";
import type { DevicePlatform, DeviceToken } from "./device-token.js";
import type { Event } from "./events.js";
import type { Machine } from "./machine.js";
import type { Permission, PermissionStatus } from "./permission.js";
import type { Session, SessionStatus } from "./session.js";

/**
 * `BackendPort` — la capa de abstracción sobre el BaaS.
 *
 * Ni el runner ni la app llaman a Supabase directamente: hablan con esta
 * interfaz. Hoy la implementa `backend-supabase`; para tests, `backend-memory`.
 * Mañana, lo que quieras (self-host). Es el contrato que hace portable el sistema.
 */
export interface BackendPort {
  // --- Auth ---
  /** Id del usuario autenticado, o `null` si no hay sesión. */
  getCurrentUserId(): Promise<string | null>;

  // --- Máquinas (lado runner) ---
  registerMachine(input: RegisterMachineInput): Promise<Machine>;
  /** Actualiza `lastSeen` y marca la máquina online. */
  heartbeat(machineId: string): Promise<void>;
  /** Cambia el estado de la máquina (p. ej. a offline en un apagado limpio). */
  setMachineStatus(machineId: string, status: Machine["status"]): Promise<void>;
  /** Lista las máquinas del usuario. */
  listMachines(): Promise<Machine[]>;

  // --- Sesiones ---
  createSession(input: CreateSessionInput): Promise<Session>; // runner
  updateSession(id: string, patch: UpdateSessionInput): Promise<Session>; // runner
  listSessions(): Promise<Session[]>; // app
  /** Cambios en sesiones (creación/estado) en vivo. */
  subscribeSessions(
    handler: (session: Session) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe; // app

  // --- Eventos (actividad del agente: runner escribe, app lee) ---
  appendEvent(input: AppendEventInput): Promise<Event>; // runner
  listEvents(sessionId: string): Promise<Event[]>; // app
  /** Eventos nuevos de una sesión en vivo (no reproduce el histórico). */
  subscribeEvents(
    sessionId: string,
    handler: (event: Event) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe; // app

  // --- Comandos (órdenes de la app: app escribe, runner lee) ---
  sendCommand(input: SendCommandInput): Promise<Command>; // app
  /** Comandos dirigidos a las sesiones/máquina de este runner, en vivo. */
  subscribeCommands(
    machineId: string,
    handler: (command: Command) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe; // runner
  /** Marca un comando como procesado (idempotencia: no re-ejecutar al reconectar). */
  markCommandConsumed(commandId: string): Promise<void>; // runner
  /** Comandos sin consumir de esta máquina (catch-up al (re)suscribir). */
  listPendingCommands(machineId: string): Promise<Command[]>; // runner

  // --- Permisos (runner crea, app decide) ---
  createPermission(input: CreatePermissionInput): Promise<Permission>; // runner
  /** Resuelve un permiso (approved/rejected/expired). */
  resolvePermission(permissionId: string, status: PermissionStatus): Promise<Permission>;
  /** Permisos aún pendientes de una sesión (re-suscripción tras un corte). */
  listPendingPermissions(sessionId: string): Promise<Permission[]>;

  // --- Tokens de dispositivo (push) ---
  /** Registra (upsert) el token de push del dispositivo del usuario. */
  registerDeviceToken(input: CreateDeviceTokenInput): Promise<DeviceToken>; // app
  /** Tokens de push del usuario. */
  listDeviceTokens(): Promise<DeviceToken[]>;
}

export interface CreateDeviceTokenInput {
  token: string;
  platform: DevicePlatform;
}

export interface CreatePermissionInput {
  sessionId: string;
  tool: string;
  summary: string;
  diff?: Payload;
  /** Cuándo expira (el runner aplica la política por defecto al vencer). */
  expiresAt?: string;
}

/** Cancela una suscripción. */
export type Unsubscribe = () => void;

/** Estado de una suscripción en vivo (p. ej. `"SUBSCRIBED"` cuando ya está lista). */
export type SubscriptionStatusHandler = (status: string) => void;

/** `Omit` que respeta las uniones discriminadas (las distribuye variante a variante). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Lo que el runner aporta al emitir un evento. El backend asigna `id`, `ts` y
 * `protocolVersion`, de modo que la versión siempre sea la correcta.
 */
export type AppendEventInput = DistributiveOmit<Event, "id" | "ts" | "protocolVersion">;

/** Lo que la app aporta al mandar un comando. El backend asigna `id`/`ts`/`protocolVersion`. */
export type SendCommandInput = DistributiveOmit<Command, "id" | "ts" | "protocolVersion">;

export interface RegisterMachineInput {
  name: string;
  /** Si se pasa, re-registra una máquina existente (reconexión); si no, crea una. */
  id?: string;
}

export interface CreateSessionInput {
  machineId: string;
  agentType: Session["agentType"];
  title: string;
  cwd: string;
  /** Por defecto `"starting"`. */
  status?: SessionStatus;
}

export type UpdateSessionInput = Partial<Pick<Session, "title" | "status">>;
