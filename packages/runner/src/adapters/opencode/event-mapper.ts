import type { Event, Part } from "@opencode-ai/sdk";
import type { OpencodeMessage } from "./transport.js";

/**
 * Mapea un evento del SDK de opencode a un `OpencodeMessage`, o `null` si no es
 * relevante. Función pura (testeable): fija el contrato de eventos que leímos de
 * los tipos del SDK v1.17.9. La lógica de streaming/dedup y el filtro por sesión
 * viven en `sdk-transport.ts`; aquí solo se traduce el shape.
 */
export function mapOpencodeEvent(event: Event): OpencodeMessage | null {
  switch (event.type) {
    case "message.part.updated":
      return mapPart(event.properties.part);
    case "session.idle":
      return { kind: "result", outcome: "completed" };
    case "session.error":
      return { kind: "error", message: errorMessage(event.properties.error) };
    default:
      return null;
  }
}

/** Traduce una parte de mensaje: texto→text, razonamiento→thinking, tool→tool_use. */
export function mapPart(part: Part): OpencodeMessage | null {
  switch (part.type) {
    case "text":
      return part.text ? { kind: "text", text: part.text } : null;
    case "reasoning":
      return part.text ? { kind: "thinking", text: part.text } : null;
    case "tool":
      return { kind: "tool_use", tool: part.tool, title: part.tool };
    default:
      return null;
  }
}

/** Extrae un mensaje legible del error de opencode (todas las variantes traen data.message). */
function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: { message?: unknown } }).data;
    if (data && typeof data.message === "string") return data.message;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "error de opencode";
}
