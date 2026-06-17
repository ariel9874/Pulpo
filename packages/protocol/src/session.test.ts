import { describe, expect, it } from "vitest";
import { safeParseSession } from "./session.js";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-16T10:00:00.000Z";

const validSession = {
  id: ID_A,
  machineId: ID_B,
  agentType: "claude-code",
  title: "Refactor auth",
  status: "running",
  cwd: "/home/ariel/proyecto",
  createdAt: TS,
  updatedAt: TS,
};

describe("sessionSchema", () => {
  it("acepta una sesión bien formada", () => {
    expect(safeParseSession(validSession).success).toBe(true);
  });

  it("rechaza un status inválido", () => {
    expect(safeParseSession({ ...validSession, status: "zombie" }).success).toBe(false);
  });

  it("rechaza un cwd vacío", () => {
    expect(safeParseSession({ ...validSession, cwd: "" }).success).toBe(false);
  });

  it("rechaza un agentType desconocido", () => {
    expect(safeParseSession({ ...validSession, agentType: "hal9000" }).success).toBe(false);
  });
});
