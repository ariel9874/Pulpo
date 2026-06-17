import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./common.js";
import { safeParseCommand, type Command } from "./commands.js";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const TS = "2026-06-16T10:00:00.000Z";

const base = { protocolVersion: PROTOCOL_VERSION, id: ID_A, ts: TS };

/** Un ejemplo válido por cada variante de comando. */
const validCommands: Record<Command["type"], unknown> = {
  new_task: {
    ...base,
    type: "new_task",
    machineId: ID_B,
    agentType: "claude-code",
    cwd: "/home/ariel/proyecto",
    prompt: "Refactoriza el módulo de auth",
    title: "Refactor auth",
  },
  send_message: { ...base, type: "send_message", sessionId: ID_B, text: "sigue" },
  approve: { ...base, type: "approve", sessionId: ID_B, permissionId: ID_C },
  reject: { ...base, type: "reject", sessionId: ID_B, permissionId: ID_C, reason: "no" },
  cancel: { ...base, type: "cancel", sessionId: ID_B },
};

describe("commandSchema — ejemplos válidos", () => {
  for (const [type, example] of Object.entries(validCommands)) {
    it(`acepta un comando '${type}' bien formado`, () => {
      expect(safeParseCommand(example).success).toBe(true);
    });
  }
});

describe("commandSchema — ejemplos inválidos", () => {
  it("rechaza una protocolVersion desconocida", () => {
    expect(safeParseCommand({ ...validCommands.cancel, protocolVersion: 2 }).success).toBe(false);
  });

  it("rechaza un type desconocido", () => {
    expect(safeParseCommand({ ...base, type: "auto_destruir" }).success).toBe(false);
  });

  it("rechaza new_task con agentType inválido", () => {
    expect(safeParseCommand({ ...validCommands.new_task, agentType: "skynet" }).success).toBe(
      false,
    );
  });

  it("rechaza new_task con prompt vacío", () => {
    expect(safeParseCommand({ ...validCommands.new_task, prompt: "" }).success).toBe(false);
  });

  it("rechaza send_message sin sessionId", () => {
    const partial = { ...(validCommands.send_message as Record<string, unknown>) };
    delete partial.sessionId;
    expect(safeParseCommand(partial).success).toBe(false);
  });

  it("rechaza approve con permissionId inválido", () => {
    expect(safeParseCommand({ ...validCommands.approve, permissionId: "x" }).success).toBe(false);
  });
});
