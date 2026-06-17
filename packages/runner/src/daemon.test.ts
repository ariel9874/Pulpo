import { MemoryBackend } from "@batuta/backend-memory";
import { describe, expect, it } from "vitest";
import { RunnerDaemon } from "./daemon.js";

async function statusOf(backend: MemoryBackend, machineId: string): Promise<string> {
  const machine = (await backend.listMachines()).find((m) => m.id === machineId);
  if (!machine) throw new Error("máquina no encontrada");
  return machine.status;
}

describe("RunnerDaemon (con backend en memoria)", () => {
  it("marca la máquina online al arrancar y offline al parar", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    await backend.setMachineStatus(machine.id, "offline");
    expect(await statusOf(backend, machine.id)).toBe("offline");

    const daemon = new RunnerDaemon(backend, machine.id, { heartbeatIntervalMs: 1_000 });
    await daemon.start();
    expect(await statusOf(backend, machine.id)).toBe("online");

    await daemon.stop();
    expect(await statusOf(backend, machine.id)).toBe("offline");
  });

  it("el heartbeat periódico refresca lastSeen", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });

    const daemon = new RunnerDaemon(backend, machine.id, { heartbeatIntervalMs: 30 });
    await daemon.start();
    const seen1 = (await backend.listMachines())[0]!.lastSeen;
    await new Promise((r) => setTimeout(r, 80));
    const seen2 = (await backend.listMachines())[0]!.lastSeen;
    await daemon.stop();

    expect(Date.parse(seen2)).toBeGreaterThanOrEqual(Date.parse(seen1));
  });
});
