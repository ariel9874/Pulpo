import type { Event } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import { mapOpencodeEvent } from "./event-mapper.js";

/** Construye un `message.part.updated` con la parte dada (shape real del SDK). */
function partEvent(part: Record<string, unknown>): Event {
  return { type: "message.part.updated", properties: { part } } as unknown as Event;
}

describe("mapOpencodeEvent", () => {
  it("parte de texto → message", () => {
    const ev = partEvent({ id: "p1", sessionID: "s", messageID: "m", type: "text", text: "hola" });
    expect(mapOpencodeEvent(ev)).toEqual({ kind: "text", text: "hola" });
  });

  it("parte de razonamiento → thinking", () => {
    const ev = partEvent({
      id: "p2",
      sessionID: "s",
      messageID: "m",
      type: "reasoning",
      text: "pensando",
    });
    expect(mapOpencodeEvent(ev)).toEqual({ kind: "thinking", text: "pensando" });
  });

  it("parte de tool → tool_use", () => {
    const ev = partEvent({
      id: "p3",
      sessionID: "s",
      messageID: "m",
      type: "tool",
      callID: "c1",
      tool: "edit",
      state: { status: "running" },
    });
    expect(mapOpencodeEvent(ev)).toEqual({ kind: "tool_use", tool: "edit", title: "edit" });
  });

  it("texto vacío → null (nada que mostrar todavía)", () => {
    const ev = partEvent({ id: "p", sessionID: "s", messageID: "m", type: "text", text: "" });
    expect(mapOpencodeEvent(ev)).toBeNull();
  });

  it("partes irrelevantes (step-start, file…) → null", () => {
    expect(mapOpencodeEvent(partEvent({ type: "step-start", id: "p", sessionID: "s", messageID: "m" }))).toBeNull();
    expect(mapOpencodeEvent(partEvent({ type: "file", id: "p", sessionID: "s", messageID: "m" }))).toBeNull();
  });

  it("session.idle → result completed", () => {
    const ev = { type: "session.idle", properties: { sessionID: "s" } } as unknown as Event;
    expect(mapOpencodeEvent(ev)).toEqual({ kind: "result", outcome: "completed" });
  });

  it("session.error → error con data.message", () => {
    const ev = {
      type: "session.error",
      properties: { sessionID: "s", error: { name: "UnknownError", data: { message: "boom" } } },
    } as unknown as Event;
    expect(mapOpencodeEvent(ev)).toEqual({ kind: "error", message: "boom" });
  });

  it("session.error sin detalle → mensaje por defecto", () => {
    const ev = { type: "session.error", properties: { sessionID: "s" } } as unknown as Event;
    expect(mapOpencodeEvent(ev)).toEqual({ kind: "error", message: "error de opencode" });
  });

  it("eventos no relevantes → null", () => {
    const ev = { type: "session.created", properties: {} } as unknown as Event;
    expect(mapOpencodeEvent(ev)).toBeNull();
  });
});
