import { z } from "zod";
import { agentTypeSchema } from "./common.js";

/**
 * Capacidades de un agente **en una máquina concreta**. Las publica el runner
 * (que sabe qué está instalado/logueado en su PC) y las lee la app para adaptar
 * la UI: qué agentes ofrecer, su catálogo de modelos, y qué controles mostrar.
 *
 * Nada se finge: si un agente no soporta una capacidad (p. ej. el CLI headless de
 * Antigravity no expone gating de permisos), el flag va en `false` y la app lo
 * refleja con honestidad en vez de simularlo.
 */

/** Un modelo ofrecido por un agente (id que entiende el agente + etiqueta UI). */
export const agentModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type AgentModel = z.infer<typeof agentModelSchema>;

export const agentCapabilitySchema = z.object({
  agentType: agentTypeSchema,
  /** Etiqueta legible del agente. */
  label: z.string().min(1),
  /** ¿El agente está instalado/usable en esta máquina? Si no, la app lo oculta. */
  available: z.boolean(),
  /** Modelos disponibles. Vacío = el agente usa su modelo por defecto (sin selector). */
  models: z.array(agentModelSchema),
  /** ¿Soporta nivel de razonamiento (effort)? */
  supportsEffort: z.boolean(),
  /** ¿Soporta gating de permisos por herramienta (aprobar/rechazar)? */
  supportsPermissions: z.boolean(),
  /** ¿Reporta uso/tokens al terminar? */
  supportsUsage: z.boolean(),
});
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;

export const agentCapabilitiesSchema = z.array(agentCapabilitySchema);

export const parseAgentCapabilities = (input: unknown): AgentCapability[] =>
  agentCapabilitiesSchema.parse(input);
export const safeParseAgentCapabilities = (input: unknown) =>
  agentCapabilitiesSchema.safeParse(input);
