/**
 * @pulpo/runner — el demonio local que lanza los agentes y traduce su
 * actividad al protocolo.
 *
 * Etapas 7-9: emparejamiento, heartbeat y cableado de agentes (contrato
 * AgentAdapter + adaptador echo). Los adaptadores reales llegan en 10-12.
 */

export * from "./credentials.js";
export * from "./pair.js";
export * from "./daemon.js";
export * from "./agent-adapter.js";
export * from "./agent-runner.js";
export * from "./adapters/echo.js";
export * from "./adapters/claude-code/index.js";
