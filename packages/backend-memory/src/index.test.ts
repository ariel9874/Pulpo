import { describe, expect, it } from "vitest";
import type { Command, Event } from "@pulpo/protocol";
import { MemoryBackend } from "./index.js";

/** Espera el primer valor entregado a un handler de suscripción. */
function once<T>(subscribe: (handler: (value: T) => void) => () => void): Promise<T> {
  return new Promise<T>((resolve) => {
    const unsubscribe = subscribe((value) => {
      unsubscribe();
      resolve(value);
    });
  });
}

async function seededSession(backend: MemoryBackend) {
  const machine = await backend.registerMachine({ name: "PC de prueba" });
  const session = await backend.createSession({
    machineId: machine.id,
    agentType: "echo",
    title: "Demo",
    cwd: "/tmp/demo",
  });
  return { machine, session };
}

describe("MemoryBackend — criterio de la Etapa 3", () => {
  it("crear sesión → append de evento → recibirlo por la suscripción (sin red)", async () => {
    const backend = new MemoryBackend();
    const { session } = await seededSession(backend);

    const received = once<Event>((h) => backend.subscribeEvents(session.id, h));

    const appended = await backend.appendEvent({
      sessionId: session.id,
      type: "message",
      role: "agent",
      text: "hola desde el runner",
    });

    const event = await received;
    expect(event.id).toBe(appended.id);
    expect(event).toMatchObject({
      sessionId: session.id,
      type: "message",
      protocolVersion: 1,
    });
  });
});

describe("MemoryBackend — sesiones y eventos", () => {
  it("lista sesiones y eventos creados", async () => {
    const backend = new MemoryBackend();
    const { session } = await seededSession(backend);
    await backend.appendEvent({ sessionId: session.id, type: "thought", text: "mmm" });

    expect(await backend.listSessions()).toHaveLength(1);
    expect(await backend.listEvents(session.id)).toHaveLength(1);
  });

  it("deleteSession borra la sesión y, en cascada, sus eventos/comandos/permisos", async () => {
    const backend = new MemoryBackend();
    const { machine, session } = await seededSession(backend);
    await backend.appendEvent({ sessionId: session.id, type: "thought", text: "x" });
    await backend.sendCommand({ type: "send_message", sessionId: session.id, text: "hola" });
    await backend.createPermission({ sessionId: session.id, tool: "fs", summary: "edita" });

    // Una segunda sesión que NO debe verse afectada por el borrado.
    const other = await backend.createSession({
      machineId: machine.id,
      agentType: "echo",
      title: "Otra",
      cwd: "/otra",
    });

    await backend.deleteSession(session.id);

    expect(await backend.listSessions()).toEqual([other]);
    expect(await backend.listEvents(session.id)).toHaveLength(0);
    expect(await backend.listPendingCommands(machine.id)).toHaveLength(0);
    expect(await backend.listPendingPermissions(session.id)).toHaveLength(0);
  });

  it("notifica cambios de sesión por subscribeSessions", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const received = once((h) => backend.subscribeSessions(h));
    const created = await backend.createSession({
      machineId: machine.id,
      agentType: "echo",
      title: "X",
      cwd: "/x",
    });
    expect((await received).id).toBe(created.id);
  });

  it("subscribeEvents no reproduce el histórico, solo lo nuevo", async () => {
    const backend = new MemoryBackend();
    const { session } = await seededSession(backend);
    await backend.appendEvent({ sessionId: session.id, type: "thought", text: "viejo" });

    const received = once<Event>((h) => backend.subscribeEvents(session.id, h));
    await backend.appendEvent({ sessionId: session.id, type: "thought", text: "nuevo" });

    expect((await received).type).toBe("thought");
    expect(await backend.listEvents(session.id)).toHaveLength(2);
  });
});

describe("MemoryBackend — comandos (app → runner)", () => {
  it("entrega a la máquina un comando dirigido a una de sus sesiones", async () => {
    const backend = new MemoryBackend();
    const { machine, session } = await seededSession(backend);

    const received = once<Command>((h) => backend.subscribeCommands(machine.id, h));
    const sent = await backend.sendCommand({
      type: "send_message",
      sessionId: session.id,
      text: "sigue",
    });

    expect((await received).id).toBe(sent.id);
  });

  it("entrega un new_task por machineId", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });

    const received = once<Command>((h) => backend.subscribeCommands(machine.id, h));
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "claude-code",
      cwd: "/proj",
      prompt: "haz algo",
    });

    expect((await received).type).toBe("new_task");
  });

  it("marca comandos como consumed (idempotencia)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const cmd = await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "p",
    });
    expect(backend.isCommandConsumed(cmd.id)).toBe(false);
    await backend.markCommandConsumed(cmd.id);
    expect(backend.isCommandConsumed(cmd.id)).toBe(true);
  });
});

describe("MemoryBackend — robustez del doble de prueba", () => {
  it("unsubscribe detiene la entrega", async () => {
    const backend = new MemoryBackend();
    const { session } = await seededSession(backend);

    let count = 0;
    const unsubscribe = backend.subscribeEvents(session.id, () => {
      count += 1;
    });
    unsubscribe();
    await backend.appendEvent({ sessionId: session.id, type: "thought", text: "x" });
    await new Promise((r) => setTimeout(r, 0));
    expect(count).toBe(0);
  });

  it("valida en el borde: rechaza un evento mal formado", async () => {
    const backend = new MemoryBackend();
    const { session } = await seededSession(backend);
    await expect(
      // role inválido para un evento message
      backend.appendEvent({
        sessionId: session.id,
        type: "message",
        role: "robot",
        text: "x",
      } as never),
    ).rejects.toThrow();
  });
});
