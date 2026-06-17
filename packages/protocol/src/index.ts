/**
 * @batuta/protocol — el contrato que todos los componentes hablan.
 *
 * Por ahora (Etapa 1) solo exporta la versión del protocolo. Los tipos
 * `Session`, `Event`, `Command` y sus validadores zod llegan en la Etapa 2.
 */

/** Versión del protocolo. Runner y app la comparan para detectar incompatibilidades. */
export const PROTOCOL_VERSION = 1 as const;
