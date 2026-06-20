import { z } from "zod";
import { agentTypeSchema, effortLevelSchema, isoDateTimeSchema, uuidSchema } from "./common.js";

/** Estado de una sesión de agente a lo largo de su ciclo de vida. */
export const sessionStatusSchema = z.enum([
  "starting",
  "running",
  "waiting_permission",
  "waiting_input",
  "done",
  "error",
  "cancelled",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** Una sesión de agente. La escribe el runner; la lee la app. */
export const sessionSchema = z.object({
  id: uuidSchema,
  machineId: uuidSchema,
  agentType: agentTypeSchema,
  title: z.string(),
  status: sessionStatusSchema,
  /** Directorio de trabajo / proyecto donde corre el agente. */
  cwd: z.string().min(1),
  /** Modelo elegido para la tarea (alias o ID). Solo aplica a agentes Claude. */
  model: z.string().min(1).optional(),
  /** Nivel de razonamiento elegido para la tarea. */
  effort: effortLevelSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Session = z.infer<typeof sessionSchema>;

/** Estados finales: la sesión ya no avanza por sí sola. */
export const TERMINAL_SESSION_STATUSES = [
  "done",
  "error",
  "cancelled",
] as const satisfies readonly SessionStatus[];

/**
 * ¿La sesión terminó? Se usa al reconectar para detectar "huérfanas": sesiones
 * en un estado no-terminal cuyo runner murió, que hay que cerrar para que no
 * queden eternamente "en curso" (ver `AgentRunner`).
 */
export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return (TERMINAL_SESSION_STATUSES as readonly SessionStatus[]).includes(status);
}

export const parseSession = (input: unknown): Session => sessionSchema.parse(input);
export const safeParseSession = (input: unknown) => sessionSchema.safeParse(input);
