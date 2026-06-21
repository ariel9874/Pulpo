import type { Machine, Session } from "@batuta/protocol";
import { describe, expect, it } from "vitest";
import { groupByMachine } from "./grouping";

const NOW = Date.parse("2026-06-17T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const machine = (id: string, name: string, online: boolean): Machine => ({
  id,
  userId: "u",
  name,
  status: online ? "online" : "offline",
  lastSeen: ago(online ? 1_000 : 60 * 60_000),
  createdAt: ago(0),
  agents: [],
});

const session = (id: string, machineId: string, createdAt: string): Session => ({
  id,
  machineId,
  agentType: "echo",
  title: id,
  status: "running",
  cwd: "/x",
  createdAt,
  updatedAt: createdAt,
});

describe("groupByMachine", () => {
  it("agrupa las sesiones bajo su máquina", () => {
    const m1 = machine("m1", "PC-1", true);
    const groups = groupByMachine(
      [m1],
      [session("a", "m1", ago(2_000)), session("b", "m1", ago(1_000))],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.machine?.id).toBe("m1");
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["b", "a"]); // más nueva primero
  });

  it("incluye máquinas sin sesiones (para ver PCs emparejadas)", () => {
    const groups = groupByMachine([machine("m1", "PC-1", true)], [], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions).toHaveLength(0);
  });

  it("ordena máquinas online primero y luego por nombre", () => {
    const groups = groupByMachine(
      [machine("z", "Zeta", false), machine("a", "Alfa", false), machine("o", "Online", true)],
      [],
      NOW,
    );
    expect(groups.map((g) => g.machine?.id)).toEqual(["o", "a", "z"]);
  });

  it("marca online según heartbeat (obsoleto → offline aunque status sea online)", () => {
    const stale: Machine = { ...machine("m1", "PC-1", true), lastSeen: ago(60 * 60_000) };
    const groups = groupByMachine([stale], [], NOW);
    expect(groups[0]?.online).toBe(false);
  });

  it("pone las sesiones de máquina desconocida en un grupo final", () => {
    const groups = groupByMachine(
      [machine("m1", "PC-1", true)],
      [session("a", "m1", ago(1_000)), session("huerfana", "borrada", ago(1_000))],
      NOW,
    );
    expect(groups).toHaveLength(2);
    expect(groups[1]?.machine).toBeNull();
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(["huerfana"]);
  });
});
