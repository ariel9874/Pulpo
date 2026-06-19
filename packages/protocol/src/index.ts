/**
 * @batuta/protocol — el contrato que todos los componentes hablan.
 *
 * El runner emite `Event`; la app emite `Command`. Ambos validan en los bordes
 * con zod para que nunca entre basura a la BD. Cada evento/comando lleva
 * `protocolVersion` para detectar incompatibilidades entre runner y app.
 */

export * from "./common.js";
export * from "./machine.js";
export * from "./session.js";
export * from "./events.js";
export * from "./commands.js";
export * from "./permission.js";
export * from "./device-token.js";
export * from "./backend-port.js";
export * from "./signing.js";
export * from "./encryption.js";
