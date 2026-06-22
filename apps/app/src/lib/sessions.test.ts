import type { Session } from "@pulpo/protocol";
import { describe, expect, it } from "vitest";
import { upsertSession } from "./sessions";

const make = (id: string, createdAt: string, title = id): Session => ({
  id,
  machineId: "m",
  agentType: "echo",
  title,
  status: "running",
  cwd: "/x",
  createdAt,
  updatedAt: createdAt,
});

describe("upsertSession", () => {
  it("añade una sesión nueva (más reciente primero)", () => {
    const a = make("a", "2026-01-01T00:00:00.000Z");
    const b = make("b", "2026-01-02T00:00:00.000Z");
    expect(upsertSession([a], b).map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("reemplaza una existente por id, sin duplicar", () => {
    const a1 = make("a", "2026-01-01T00:00:00.000Z", "viejo");
    const a2 = make("a", "2026-01-01T00:00:00.000Z", "nuevo");
    const result = upsertSession([a1], a2);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("nuevo");
  });
});
