import { z } from "zod";
import { isoDateTimeSchema, payloadSchema, uuidSchema } from "./common.js";

/** Estado de una petición de permiso. */
export const permissionStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
export type PermissionStatus = z.infer<typeof permissionStatusSchema>;

/**
 * Petición de permiso: el agente quiere hacer algo (p. ej. modificar un archivo)
 * y espera tu decisión. Persiste para sobrevivir a cortes de red. La crea el
 * runner; la decide la app (vía commands approve/reject).
 */
export const permissionSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  status: permissionStatusSchema,
  tool: z.string().min(1),
  summary: z.string(),
  /** Diff a aprobar: inline si es chico o por referencia a Storage si es grande. */
  diff: payloadSchema.optional(),
  expiresAt: isoDateTimeSchema.optional(),
  decidedAt: isoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema,
});
export type Permission = z.infer<typeof permissionSchema>;

export const parsePermission = (input: unknown): Permission => permissionSchema.parse(input);
export const safeParsePermission = (input: unknown) => permissionSchema.safeParse(input);
