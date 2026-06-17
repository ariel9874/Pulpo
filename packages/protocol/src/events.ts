import { z } from "zod";
import {
  artifactSchema,
  isoDateTimeSchema,
  payloadSchema,
  protocolVersionSchema,
  uuidSchema,
} from "./common.js";

/**
 * Eventos: actividad del agente. Los **escribe el runner** y los **lee la app**.
 * Append-only. Unión discriminada por `type`.
 */
const eventBase = {
  protocolVersion: protocolVersionSchema,
  id: uuidSchema,
  sessionId: uuidSchema,
  ts: isoDateTimeSchema,
};

/** Mensaje en lenguaje natural (del agente, del usuario reflejado, o del sistema). */
export const messageEventSchema = z.object({
  ...eventBase,
  type: z.literal("message"),
  role: z.enum(["agent", "user", "system"]),
  text: z.string(),
});

/** Razonamiento del agente (opcional de mostrar en la app). */
export const thoughtEventSchema = z.object({
  ...eventBase,
  type: z.literal("thought"),
  text: z.string(),
});

/** Uso de una herramienta por el agente, con su estado. */
export const toolCallEventSchema = z.object({
  ...eventBase,
  type: z.literal("tool_call"),
  tool: z.string().min(1),
  title: z.string(),
  status: z.enum(["started", "succeeded", "failed"]),
  /** Detalle/salida; inline si es chico o por referencia a Storage si es grande. */
  detail: payloadSchema.optional(),
});

/** Un paso del plan del agente. */
export const planStepEventSchema = z.object({
  ...eventBase,
  type: z.literal("plan_step"),
  index: z.number().int().nonnegative(),
  total: z.number().int().positive().optional(),
  step: z.string().min(1),
  state: z.enum(["pending", "in_progress", "done"]),
});

/** El agente pide permiso y queda esperando decisión. Lleva el diff. */
export const permissionRequiredEventSchema = z.object({
  ...eventBase,
  type: z.literal("permission_required"),
  /** Enlaza con la fila de `permissions` y con los comandos approve/reject. */
  permissionId: uuidSchema,
  tool: z.string().min(1),
  summary: z.string(),
  /** Diff a aprobar; inline si es chico o por referencia a Storage si es grande. */
  diff: payloadSchema.optional(),
});

/** La tarea terminó (completada, cancelada o fallida). */
export const taskDoneEventSchema = z.object({
  ...eventBase,
  type: z.literal("task_done"),
  outcome: z.enum(["completed", "cancelled", "failed"]),
  summary: z.string().optional(),
});

/** Error del agente o del adaptador. */
export const errorEventSchema = z.object({
  ...eventBase,
  type: z.literal("error"),
  message: z.string().min(1),
  detail: z.string().optional(),
});

/** El agente hace una pregunta y espera respuesta del usuario. */
export const questionEventSchema = z.object({
  ...eventBase,
  type: z.literal("question"),
  questionId: uuidSchema,
  question: z.string().min(1),
});

/** Recurso generado por la IA (texto, imagen, audio, video, fichero). */
export const artifactEventSchema = z.object({
  ...eventBase,
  type: z.literal("artifact"),
  artifact: artifactSchema,
});

export const eventSchema = z.discriminatedUnion("type", [
  messageEventSchema,
  thoughtEventSchema,
  toolCallEventSchema,
  planStepEventSchema,
  permissionRequiredEventSchema,
  taskDoneEventSchema,
  errorEventSchema,
  questionEventSchema,
  artifactEventSchema,
]);
export type Event = z.infer<typeof eventSchema>;
export type EventType = Event["type"];

export const parseEvent = (input: unknown): Event => eventSchema.parse(input);
export const safeParseEvent = (input: unknown) => eventSchema.safeParse(input);
