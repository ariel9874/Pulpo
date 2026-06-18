import { describe, expect, it } from "vitest";
import { isTerminalSessionStatus, safeParseSession } from "./session.js";

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

describe("isTerminalSessionStatus", () => {
  it("done/error/cancelled son terminales", () => {
    expect(isTerminalSessionStatus("done")).toBe(true);
    expect(isTerminalSessionStatus("error")).toBe(true);
    expect(isTerminalSessionStatus("cancelled")).toBe(true);
  });

  it("starting/running/waiting_* no son terminales (siguen vivas)", () => {
    expect(isTerminalSessionStatus("starting")).toBe(false);
    expect(isTerminalSessionStatus("running")).toBe(false);
    expect(isTerminalSessionStatus("waiting_permission")).toBe(false);
    expect(isTerminalSessionStatus("waiting_input")).toBe(false);
  });
});
