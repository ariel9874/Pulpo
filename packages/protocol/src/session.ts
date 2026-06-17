import { z } from "zod";
import { agentTypeSchema, isoDateTimeSchema, uuidSchema } from "./common.js";

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
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export const parseSession = (input: unknown): Session => sessionSchema.parse(input);
export const safeParseSession = (input: unknown) => sessionSchema.safeParse(input);
