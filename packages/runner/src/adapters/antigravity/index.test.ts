import { MemoryBackend } from "@batuta/backend-memory";
import type { Session } from "@batuta/protocol";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../agent-adapter.js";
import { AgentRunner } from "../../agent-runner.js";
import { AntigravityAdapter } from "./index.js";
import { AgyCliTransport } from "./cli-transport.js";
import type {
  AntigravityMessage,
  AntigravityRunOptions,
  AntigravityTransport,
} from "./transport.js";

/** Transporte simulado: emite mensajes prefijados, sin CLI. */
class ScriptedTransport implements AntigravityTransport {
  constructor(private readonly messages: AntigravityMessage[]) {}
  async *run(): AsyncIterable<AntigravityMessage> {
    for (const message of this.messages) {
      await Promise.resolve();
      yield message;
    }
  }
}

/** Transporte simulado en streaming: hace eco de cada turno de entrada. */
class StreamingTransport implements AntigravityTransport {
  async *run(options: AntigravityRunOptions): AsyncIterable<AntigravityMessage> {
    for await (const text of options.input) {
      yield { kind: "text", text: `agy: ${text}` };
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
    agentType: "antigravity",
    title: "demo",
    status: "running",
    cwd,
    createdAt: now,
    updatedAt: now,
  };
}

describe("AntigravityAdapter (transporte simulado)", () => {
  it("mapea la actividad de Antigravity a eventos del protocolo", async () => {
    const adapter = new AntigravityAdapter(
      () =>
        new ScriptedTransport([
          { kind: "thinking", text: "planeando" },
          { kind: "text", text: "voy a crear el archivo" },
          { kind: "tool_use", tool: "write_file", title: "write src/a.ts" },
          { kind: "result", outcome: "completed" },
        ]),
    );

    const events: AgentEvent[] = [];
    const agentSession = await adapter.start({
      session: fakeSession(),
      prompt: "crea a.ts",
      emit: async (event) => {
        events.push(event);
      },
      requestPermission: async () => "allow",
    });

    await waitFor(() => (events.some((e) => e.type === "task_done") ? true : undefined));
    expect(events.map((e) => e.type)).toEqual(["thought", "message", "tool_call", "task_done"]);
    await agentSession.dispose();
  });

  it("se enchufa al AgentRunner como agente antigravity (MemoryBackend)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const adapter = new AntigravityAdapter(
      () =>
        new ScriptedTransport([
          { kind: "text", text: "listo" },
          { kind: "result", outcome: "completed" },
        ]),
    );
    const runner = new AgentRunner(backend, machine.id, [adapter]);
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "antigravity",
      cwd: "/proj",
      prompt: "haz algo",
    });

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find((e) => e.type === "task_done"),
    );
    const events = await backend.listEvents(session.id);
    expect(events.some((e) => e.type === "message" && e.text === "listo")).toBe(true);

    await runner.stop();
  });

  it("send_message abre un nuevo turno; cancel deja la sesión cancelled", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [
      new AntigravityAdapter(() => new StreamingTransport()),
    ]);
    await runner.start();
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "antigravity",
      cwd: "/p",
      prompt: "hola",
    });
    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "agy: hola",
      ),
    );

    await backend.sendCommand({ type: "send_message", sessionId: session.id, text: "mundo" });
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "agy: mundo",
      ),
    );

    await backend.sendCommand({ type: "cancel", sessionId: session.id });
    await waitFor(async () => {
      const s = (await backend.listSessions()).find((x) => x.id === session.id);
      return s?.status === "cancelled" ? s : undefined;
    });
    await runner.stop();
  });
});

describe("AgyCliTransport — robustez", () => {
  it("si el CLI no existe (ENOENT) emite error, no tumba el proceso", async () => {
    const transport = new AgyCliTransport({ bin: "agy-binario-inexistente-xyz" });
    async function* input(): AsyncIterable<string> {
      yield "hola";
    }
    const messages: AntigravityMessage[] = [];
    for await (const m of transport.run({
      input: input(),
      cwd: process.cwd(),
      signal: new AbortController().signal,
      requestPermission: async () => "deny",
    })) {
      messages.push(m);
    }
    const error = messages.find((m) => m.kind === "error");
    expect(error).toBeDefined();
    if (error?.kind === "error") expect(error.message).toContain("agy-binario-inexistente-xyz");
  });
});

describe("AntigravityAdapter.capabilities", () => {
  it("se marca no disponible (agy v1.0.10 no es automatizable headless)", async () => {
    const cap = await new AntigravityAdapter(() => new StreamingTransport()).capabilities();
    expect(cap).toMatchObject({
      agentType: "antigravity",
      available: false,
      models: [],
      supportsEffort: false,
      supportsPermissions: false,
      supportsUsage: false,
    });
  });
});
