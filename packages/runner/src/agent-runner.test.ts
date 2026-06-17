import { MemoryBackend } from "@batuta/backend-memory";
import { describe, expect, it } from "vitest";
import { EchoAdapter } from "./adapters/echo.js";
import { AgentRunner } from "./agent-runner.js";

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("AgentRunner + EchoAdapter (cableado con MemoryBackend)", () => {
  it("new_task crea sesión y emite el eco; send_message responde con eco", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/tmp",
      prompt: "hola",
    });

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: hola",
      ),
    );

    await backend.sendCommand({ type: "send_message", sessionId: session.id, text: "mundo" });
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: mundo",
      ),
    );

    await runner.stop();
  });

  it("cancel marca la sesión como cancelled", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "p",
    });
    const session = await waitFor(async () => (await backend.listSessions())[0]);

    await backend.sendCommand({ type: "cancel", sessionId: session.id });
    const cancelled = await waitFor(async () => {
      const s = (await backend.listSessions()).find((x) => x.id === session.id);
      return s?.status === "cancelled" ? s : undefined;
    });
    expect(cancelled.status).toBe("cancelled");

    await runner.stop();
  });

  it("marca los comandos como consumidos (idempotencia)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    const command = await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "p",
    });
    await waitFor(async () => (backend.isCommandConsumed(command.id) ? true : undefined));
    expect(backend.isCommandConsumed(command.id)).toBe(true);

    await runner.stop();
  });

  it("procesa comandos pendientes al arrancar (catch-up tras reconexión)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });

    // Comando enviado ANTES de que el runner se suscriba (simula un corte de red).
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "hola",
    });

    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start(); // el catch-up procesa el comando pendiente

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: hola",
      ),
    );

    await runner.stop();
  });
});
