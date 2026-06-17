import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.js";

/** Estado de conexión de una máquina (PC con un runner). */
export const machineStatusSchema = z.enum(["online", "offline"]);
export type MachineStatus = z.infer<typeof machineStatusSchema>;

/** Una PC registrada (1 por runner). La escribe el runner; la lee la app. */
export const machineSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string().min(1),
  status: machineStatusSchema,
  lastSeen: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type Machine = z.infer<typeof machineSchema>;

export const parseMachine = (input: unknown): Machine => machineSchema.parse(input);
export const safeParseMachine = (input: unknown) => machineSchema.safeParse(input);
