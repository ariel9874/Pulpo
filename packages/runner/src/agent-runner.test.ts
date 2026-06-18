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

describe("AgentRunner — reconexión y estado (Etapa 20)", () => {
  it("una reconexión recupera el comando perdido durante el corte, sin duplicar", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    // Corte de red: el comando se guarda pero no se entrega en vivo.
    backend.simulateOutage(machine.id);
    const command = await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "hola",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(await backend.listSessions()).toHaveLength(0);
    expect(backend.isCommandConsumed(command.id)).toBe(false);

    // Vuelve la conexión → catch-up procesa el comando pendiente.
    backend.simulateReconnect(machine.id);
    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: hola",
      ),
    );

    // Otra reconexión NO duplica (el comando ya está consumido + dedup).
    backend.simulateReconnect(machine.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(await backend.listSessions()).toHaveLength(1);

    await runner.stop();
  });

  it("al arrancar cierra las sesiones huérfanas (runner muerto a media tarea)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    // Sesión que quedó "running" + un permiso pendiente de una ejecución previa.
    const orphan = await backend.createSession({
      machineId: machine.id,
      agentType: "echo",
      title: "vieja",
      cwd: "/x",
      status: "running",
    });
    await backend.createPermission({
      sessionId: orphan.id,
      tool: "Write",
      summary: "escribe algo",
    });

    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    const closed = (await backend.listSessions()).find((s) => s.id === orphan.id);
    expect(closed?.status).toBe("error");
    const events = await backend.listEvents(orphan.id);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(await backend.listPendingPermissions(orphan.id)).toHaveLength(0);

    await runner.stop();
  });

  it("no toca sesiones de otra máquina ni las ya terminadas", async () => {
    const backend = new MemoryBackend();
    const mine = await backend.registerMachine({ name: "mía" });
    const other = await backend.registerMachine({ name: "otra" });
    const otherSession = await backend.createSession({
      machineId: other.id,
      agentType: "echo",
      title: "ajena",
      cwd: "/x",
      status: "running",
    });
    const doneSession = await backend.createSession({
      machineId: mine.id,
      agentType: "echo",
      title: "hecha",
      cwd: "/x",
      status: "done",
    });

    const runner = new AgentRunner(backend, mine.id, [new EchoAdapter()]);
    await runner.start();

    const sessions = await backend.listSessions();
    expect(sessions.find((s) => s.id === otherSession.id)?.status).toBe("running");
    expect(sessions.find((s) => s.id === doneSession.id)?.status).toBe("done");

    await runner.stop();
  });

  it("reiniciar el runner no re-ejecuta un comando ya consumido y cierra la huérfana", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });

    const runner1 = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner1.start();
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "hola",
    });
    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await runner1.stop(); // muere dejando la sesión "running"

    // Reinicio: nuevo runner. El new_task ya está consumido.
    const runner2 = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner2.start();
    await new Promise((r) => setTimeout(r, 30));

    const sessions = await backend.listSessions();
    expect(sessions).toHaveLength(1); // no se duplicó el comando
    expect(sessions.find((s) => s.id === session.id)?.status).toBe("error"); // huérfana cerrada

    await runner2.stop();
  });
});
