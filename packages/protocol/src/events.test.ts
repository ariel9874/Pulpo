import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./common.js";
import { safeParseEvent, type Event } from "./events.js";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const TS = "2026-06-16T10:00:00.000Z";

const base = {
  protocolVersion: PROTOCOL_VERSION,
  id: ID_A,
  sessionId: ID_B,
  ts: TS,
};

/** Un ejemplo válido por cada variante de evento. */
const validEvents: Record<Event["type"], unknown> = {
  message: { ...base, type: "message", role: "agent", text: "hola" },
  thought: { ...base, type: "thought", text: "pensando…" },
  tool_call: {
    ...base,
    type: "tool_call",
    tool: "edit_file",
    title: "Editar a.ts",
    status: "started",
  },
  plan_step: {
    ...base,
    type: "plan_step",
    index: 0,
    total: 3,
    step: "Leer archivos",
    state: "in_progress",
  },
  permission_required: {
    ...base,
    type: "permission_required",
    permissionId: ID_C,
    tool: "edit_file",
    summary: "Modificar a.ts",
    diff: { type: "inline", content: "- viejo\n+ nuevo" },
  },
  task_done: { ...base, type: "task_done", outcome: "completed", summary: "listo" },
  error: { ...base, type: "error", message: "algo falló", detail: "stack…" },
  question: { ...base, type: "question", questionId: ID_C, question: "¿continúo?" },
  artifact: {
    ...base,
    type: "artifact",
    artifact: {
      kind: "image",
      mime: "image/png",
      name: "diagrama.png",
      size: 1234,
      ref: "sessions/abc/diagrama.png",
      hash: "sha256-deadbeef",
    },
  },
};

describe("eventSchema — ejemplos válidos", () => {
  for (const [type, example] of Object.entries(validEvents)) {
    it(`acepta un evento '${type}' bien formado`, () => {
      const result = safeParseEvent(example);
      expect(result.success).toBe(true);
    });
  }

  it("acepta un permission_required con diff por referencia a Storage", () => {
    const result = safeParseEvent({
      ...base,
      type: "permission_required",
      permissionId: ID_C,
      tool: "edit_file",
      summary: "Modificar archivo grande",
      diff: { type: "ref", ref: "diffs/x.patch", hash: "sha256-abc", size: 999999 },
    });
    expect(result.success).toBe(true);
  });
});

describe("eventSchema — ejemplos inválidos", () => {
  it("rechaza una protocolVersion desconocida", () => {
    const result = safeParseEvent({ ...validEvents.message, protocolVersion: 999 });
    expect(result.success).toBe(false);
  });

  it("rechaza un type desconocido", () => {
    const result = safeParseEvent({ ...base, type: "no_existe", text: "x" });
    expect(result.success).toBe(false);
  });

  it("rechaza un UUID inválido", () => {
    const result = safeParseEvent({ ...validEvents.message, id: "no-soy-uuid" });
    expect(result.success).toBe(false);
  });

  it("rechaza una fecha no ISO", () => {
    const result = safeParseEvent({ ...validEvents.message, ts: "ayer" });
    expect(result.success).toBe(false);
  });

  it("rechaza un campo requerido faltante (message.text)", () => {
    const { ...partial } = validEvents.message as Record<string, unknown>;
    delete partial.text;
    const result = safeParseEvent(partial);
    expect(result.success).toBe(false);
  });

  it("rechaza un enum inválido (message.role)", () => {
    const result = safeParseEvent({ ...validEvents.message, role: "robot" });
    expect(result.success).toBe(false);
  });

  it("rechaza un artifact con kind inválido", () => {
    const result = safeParseEvent({
      ...base,
      type: "artifact",
      artifact: { kind: "hologram", mime: "x/y", name: "a", size: 1, ref: "r" },
    });
    expect(result.success).toBe(false);
  });
});
