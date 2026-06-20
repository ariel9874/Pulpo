import { z } from "zod";

/**
 * Versión del protocolo. Runner y app la comparan para detectar incompatibilidades
 * y degradar con gracia en vez de romper en silencio. Cada evento y comando la lleva.
 */
export const PROTOCOL_VERSION = 1 as const;

/** Acepta exactamente la versión soportada; cualquier otra falla la validación. */
export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);

export const uuidSchema = z.string().uuid();
/** ISO-8601 con zona horaria (admite `Z` u offset explícito). */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * Tipo de agente. En la práctica es una lista abierta (cada adaptador añade el suyo),
 * pero validamos contra los conocidos para detectar typos pronto.
 */
export const agentTypeSchema = z.enum(["echo", "claude-code", "antigravity", "codex"]);
export type AgentType = z.infer<typeof agentTypeSchema>;

/**
 * Nivel de razonamiento (effort) del agente. Lo elige la app por tarea; el runner
 * lo pasa al SDK. El SDK degrada en silencio a un nivel soportado si el modelo
 * elegido no admite el pedido, así que cualquier valor es seguro.
 */
export const effortLevelSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof effortLevelSchema>;

/**
 * Payload que puede viajar inline (si es chico) o por referencia a Supabase Storage
 * (diffs y salidas grandes). Mantiene el stream Realtime ligero.
 */
export const inlinePayloadSchema = z.object({
  type: z.literal("inline"),
  content: z.string(),
});
export const refPayloadSchema = z.object({
  type: z.literal("ref"),
  /** Clave/ruta del objeto en Supabase Storage. */
  ref: z.string().min(1),
  /** Hash del contenido, para integridad y deduplicación. */
  hash: z.string().min(1),
  size: z.number().int().nonnegative(),
  mime: z.string().min(1).optional(),
});
/**
 * Payload cifrado extremo-a-extremo (cliente↔runner). El backend solo ve opaco:
 * `ciphertext`. El runner lo sella (sealed-box NaCl) hacia la clave pública de la
 * app; solo la app lo abre con su privada. Ver `encryption.ts` y SECURITY.md.
 */
export const encryptedPayloadSchema = z.object({
  type: z.literal("encrypted"),
  /**
   * `nacl-box-anon`: sealed box (remitente efímero/anónimo, solo confidencialidad).
   * `nacl-box`: box autenticado (el remitente firma con su clave persistente; el
   * receptor verifica → confidencialidad + autenticidad del emisor).
   */
  alg: z.enum(["nacl-box-anon", "nacl-box"]),
  /** Clave pública efímera del remitente (base64). Solo en `nacl-box-anon`. */
  epk: z.string().min(1).optional(),
  nonce: z.string().min(1),
  ciphertext: z.string().min(1),
});
export const payloadSchema = z.discriminatedUnion("type", [
  inlinePayloadSchema,
  refPayloadSchema,
  encryptedPayloadSchema,
]);
export type Payload = z.infer<typeof payloadSchema>;
export type EncryptedPayload = z.infer<typeof encryptedPayloadSchema>;

/** Recurso generado por la IA: texto, imagen, audio, video u otro fichero. */
export const artifactKindSchema = z.enum(["text", "image", "audio", "video", "file"]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactSchema = z.object({
  kind: artifactKindSchema,
  mime: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  /** Clave/ruta del objeto en Supabase Storage. */
  ref: z.string().min(1),
  /** Hash del contenido, para integridad y deduplicación. */
  hash: z.string().min(1).optional(),
});
export type Artifact = z.infer<typeof artifactSchema>;
