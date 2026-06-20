import { z } from "zod";
import {
  agentTypeSchema,
  effortLevelSchema,
  isoDateTimeSchema,
  protocolVersionSchema,
  uuidSchema,
} from "./common.js";

/**
 * Comandos: órdenes de la app. Los **escribe la app** y los **lee el runner**.
 * Unión discriminada por `type`. El runner los marca `consumed` (idempotencia).
 */
const commandBase = {
  protocolVersion: protocolVersionSchema,
  id: uuidSchema,
  ts: isoDateTimeSchema,
  // Firma opcional (la añade la app; el runner la exige si tiene clave configurada).
  // Ver signing.ts. Opcionales para no romper el flujo sin firma (tests, rollout).
  nonce: z.string().min(1).optional(),
  issuedAt: isoDateTimeSchema.optional(),
  signature: z.string().min(1).optional(),
};

/**
 * Crear una sesión nueva y arrancar una tarea. No lleva `sessionId`: la sesión la
 * crea el runner (es quien escribe `sessions`); por eso apunta a la `machineId`.
 */
export const newTaskCommandSchema = z.object({
  ...commandBase,
  type: z.literal("new_task"),
  machineId: uuidSchema,
  agentType: agentTypeSchema,
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  title: z.string().optional(),
  /** Modelo a usar (alias o ID); el runner lo pasa al agente. Solo Claude. */
  model: z.string().min(1).optional(),
  /** Nivel de razonamiento (effort). */
  effort: effortLevelSchema.optional(),
});

/** Mandar un mensaje a una sesión en curso. */
export const sendMessageCommandSchema = z.object({
  ...commandBase,
  type: z.literal("send_message"),
  sessionId: uuidSchema,
  text: z.string().min(1),
});

/** Aprobar un permiso pendiente. */
export const approveCommandSchema = z.object({
  ...commandBase,
  type: z.literal("approve"),
  sessionId: uuidSchema,
  permissionId: uuidSchema,
});

/** Rechazar un permiso pendiente. */
export const rejectCommandSchema = z.object({
  ...commandBase,
  type: z.literal("reject"),
  sessionId: uuidSchema,
  permissionId: uuidSchema,
  reason: z.string().optional(),
});

/** Cancelar la tarea en curso de una sesión. */
export const cancelCommandSchema = z.object({
  ...commandBase,
  type: z.literal("cancel"),
  sessionId: uuidSchema,
});

export const commandSchema = z.discriminatedUnion("type", [
  newTaskCommandSchema,
  sendMessageCommandSchema,
  approveCommandSchema,
  rejectCommandSchema,
  cancelCommandSchema,
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command["type"];

export const parseCommand = (input: unknown): Command => commandSchema.parse(input);
export const safeParseCommand = (input: unknown) => commandSchema.safeParse(input);
