import { MemoryBackend } from "@batuta/backend-memory";
import type { Session } from "@batuta/protocol";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../agent-adapter.js";
import { AgentRunner } from "../../agent-runner.js";
import { ClaudeCodeAdapter } from "./index.js";
import type { ClaudeMessage, ClaudeRunOptions, ClaudeTransport } from "./transport.js";

/** Transporte simulado: emite mensajes prefijados, sin SDK ni tokens. */
class ScriptedTransport implements ClaudeTransport {
  constructor(private readonly messages: ClaudeMessage[]) {}
  async *run(): AsyncIterable<ClaudeMessage> {
    for (const message of this.messages) {
      await Promise.resolve();
      yield message;
    }
  }
}

/** Transporte simulado que pide permiso antes de "editar" y reacciona a la decisión. */
class PermissionTransport implements ClaudeTransport {
  async *run(options: ClaudeRunOptions): AsyncIterable<ClaudeMessage> {
    yield { kind: "text", text: "voy a editar" };
    const decision = await options.requestPermission({
      tool: "Edit",
      title: "Editar a.ts",
      diff: "- a\n+ b",
    });
    if (decision === "allow") {
      yield { kind: "tool_use", tool: "Edit", title: "Editar a.ts" };
      yield { kind: "text", text: "editado" };
    } else {
      yield { kind: "text", text: "denegado" };
    }
    yield { kind: "result", outcome: "completed" };
  }
}

/** Transporte simulado en streaming: hace eco de cada mensaje de entrada (prompt + follow-ups). */
class StreamingTransport implements ClaudeTransport {
  async *run(options: ClaudeRunOptions): AsyncIterable<ClaudeMessage> {
    for await (const text of options.input) {
      yield { kind: "text", text: `eco: ${text}` };
      yield { kind: "result", outcome: "completed" };
    }
  }
}

async function waitFor<T>(
  fn: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function fakeSession(cwd = "/proj"): Session {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    machineId: "22222222-2222-4222-8222-222222222222",
    agentType: "claude-code",
    title: "demo",
    status: "running",
    cwd,
    createdAt: now,
    updatedAt: now,
  };
}

describe("ClaudeCodeAdapter (transporte simulado)", () => {
  it("mapea la actividad de Claude a eventos del protocolo", async () => {
    const adapter = new ClaudeCodeAdapter(
      () =>
        new ScriptedTransport([
          { kind: "thinking", text: "pensando" },
          { kind: "text", text: "Voy a editar el archivo" },
          { kind: "tool_use", tool: "Edit", title: "Edit: src/a.ts" },
          { kind: "result", outcome: "completed" },
        ]),
    );

    const events: AgentEvent[] = [];
    const agentSession = await adapter.start({
      session: fakeSession(),
      prompt: "edita a.ts",
      emit: async (event) => {
        events.push(event);
      },
      requestPermission: async () => "allow",
    });

    await waitFor(() => (events.some((e) => e.type === "task_done") ? true : undefined));
    expect(events.map((e) => e.type)).toEqual(["thought", "message", "tool_call", "task_done"]);
    expect(events.find((e) => e.type === "tool_call")).toMatchObject({
      tool: "Edit",
      status: "started",
    });
    await agentSession.dispose();
  });

  it("se enchufa al AgentRunner como agente claude-code (con MemoryBackend)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const adapter = new ClaudeCodeAdapter(
      () =>
        new ScriptedTransport([
          { kind: "text", text: "hecho" },
          { kind: "result", outcome: "completed" },
        ]),
    );
    const runner = new AgentRunner(backend, machine.id, [adapter]);
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "claude-code",
      cwd: "/proj",
      prompt: "haz algo",
    });

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find((e) => e.type === "task_done"),
    );
    const events = await backend.listEvents(session.id);
    expect(events.some((e) => e.type === "message" && e.text === "hecho")).toBe(true);

    await runner.stop();
  });
});

describe("ClaudeCodeAdapter — permisos (Etapa 11, sin tokens)", () => {
  async function startPermissionTask(opts?: { permissionTimeoutMs?: number }) {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(
      backend,
      machine.id,
      [new ClaudeCodeAdapter(() => new PermissionTransport())],
      opts,
    );
    await runner.start();
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "claude-code",
      cwd: "/p",
      prompt: "edita",
    });
    const session = await waitFor(async () => (await backend.listSessions())[0]);
    const permEvent = await waitFor(async () =>
      (await backend.listEvents(session.id)).find((e) => e.type === "permission_required"),
    );
    if (permEvent.type !== "permission_required") throw new Error("evento inesperado");
    return { backend, runner, session, permissionId: permEvent.permissionId };
  }

  const hasEditado = async (backend: MemoryBackend, sessionId: string): Promise<boolean> =>
    (await backend.listEvents(sessionId)).some((e) => e.type === "message" && e.text === "editado");

  it("pide permiso, se bloquea y continúa al aprobar", async () => {
    const { backend, runner, session, permissionId } = await startPermissionTask();
    expect(await hasEditado(backend, session.id)).toBe(false); // bloqueado

    await backend.sendCommand({ type: "approve", sessionId: session.id, permissionId });

    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "editado",
      ),
    );
    expect(await backend.listPendingPermissions(session.id)).toHaveLength(0);
    await runner.stop();
  });

  it("deniega al rechazar", async () => {
    const { backend, runner, session, permissionId } = await startPermissionTask();
    await backend.sendCommand({ type: "reject", sessionId: session.id, permissionId });

    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "denegado",
      ),
    );
    expect(await hasEditado(backend, session.id)).toBe(false);
    await runner.stop();
  });

  it("expira y deniega por defecto si nadie decide", async () => {
    const { backend, runner, session } = await startPermissionTask({ permissionTimeoutMs: 150 });
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "denegado",
      ),
    );
    expect(await backend.listPendingPermissions(session.id)).toHaveLength(0);
    await runner.stop();
  });
});

describe("ClaudeCodeAdapter — comandos entrantes (Etapa 12, sin tokens)", () => {
  async function startTask() {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [
      new ClaudeCodeAdapter(() => new StreamingTransport()),
    ]);
    await runner.start();
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "claude-code",
      cwd: "/p",
      prompt: "hola",
    });
    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "eco: hola",
      ),
    );
    return { backend, runner, session };
  }

  it("send_message alimenta a la sesión de Claude en curso", async () => {
    const { backend, runner, session } = await startTask();

    await backend.sendCommand({ type: "send_message", sessionId: session.id, text: "mundo" });
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "eco: mundo",
      ),
    );
    await runner.stop();
  });

  it("cancel a media tarea deja la sesión en cancelled", async () => {
    const { backend, runner, session } = await startTask();

    await backend.sendCommand({ type: "cancel", sessionId: session.id });
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "task_done" && e.outcome === "cancelled",
      ),
    );
    const updated = (await backend.listSessions()).find((s) => s.id === session.id);
    expect(updated?.status).toBe("cancelled");
    await runner.stop();
  });
});
