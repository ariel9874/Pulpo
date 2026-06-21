import { z } from "zod";
import { agentCapabilitySchema } from "./agent-capabilities.js";
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
  /** Capacidades de los agentes en esta máquina (las publica el runner). */
  agents: z.array(agentCapabilitySchema).default([]),
});
export type Machine = z.infer<typeof machineSchema>;

export const parseMachine = (input: unknown): Machine => machineSchema.parse(input);
export const safeParseMachine = (input: unknown) => machineSchema.safeParse(input);

/** Tras cuánto tiempo sin heartbeat se considera offline una máquina (ms). */
export const MACHINE_STALE_AFTER_MS = 30_000;

/**
 * ¿La máquina está realmente online? Requiere estado `online` **y** un heartbeat
 * reciente. Así, si matas el runner sin apagado limpio (no llega a marcarse
 * offline), igualmente se considera offline al quedar obsoleto su `lastSeen`.
 */
export function isMachineOnline(
  machine: Pick<Machine, "status" | "lastSeen">,
  opts: { nowMs?: number; staleAfterMs?: number } = {},
): boolean {
  if (machine.status !== "online") return false;
  const nowMs = opts.nowMs ?? Date.now();
  const staleAfterMs = opts.staleAfterMs ?? MACHINE_STALE_AFTER_MS;
  return nowMs - new Date(machine.lastSeen).getTime() < staleAfterMs;
}
