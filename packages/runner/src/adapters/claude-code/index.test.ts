import { MemoryBackend } from "@batuta/backend-memory";
import type { Session } from "@batuta/protocol";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../agent-adapter.js";
import { AgentRunner } from "../../agent-runner.js";
import { ClaudeCodeAdapter } from "./index.js";
import type { ClaudeMessage, ClaudeTransport } from "./transport.js";

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
