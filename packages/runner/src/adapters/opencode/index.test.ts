import { MemoryBackend } from "@batuta/backend-memory";
import type { Session } from "@batuta/protocol";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../agent-adapter.js";
import { AgentRunner } from "../../agent-runner.js";
import { OpencodeAdapter } from "./index.js";
import { parseModels } from "./discover.js";
import type { OpencodeMessage, OpencodeRunOptions, OpencodeTransport } from "./transport.js";

/** Transporte simulado: emite mensajes prefijados, sin servidor ni SDK. */
class ScriptedTransport implements OpencodeTransport {
  constructor(private readonly messages: OpencodeMessage[]) {}
  async *run(): AsyncIterable<OpencodeMessage> {
    for (const message of this.messages) {
      await Promise.resolve();
      yield message;
    }
  }
}

/** Transporte simulado en streaming: hace eco de cada turno de entrada. */
class StreamingTransport implements OpencodeTransport {
  async *run(options: OpencodeRunOptions): AsyncIterable<OpencodeMessage> {
    for await (const text of options.input) {
      yield { kind: "text", text: `oc: ${text}` };
      yield { kind: "result", outcome: "completed" };
    }
  }
}

/** discover stub: evita lanzar el CLI real de opencode en tests. */
const noDiscover = async () => ({ available: false, models: [] });

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
    agentType: "opencode",
    title: "demo",
    status: "running",
    cwd,
    createdAt: now,
    updatedAt: now,
  };
}

describe("OpencodeAdapter (transporte simulado)", () => {
  it("mapea la actividad de opencode a eventos del protocolo", async () => {
    const adapter = new OpencodeAdapter(
      () =>
        new ScriptedTransport([
          { kind: "thinking", text: "planeando" },
          { kind: "text", text: "voy a crear el archivo" },
          { kind: "tool_use", tool: "write", title: "write src/a.ts" },
          { kind: "result", outcome: "completed" },
        ]),
      noDiscover,
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

  it("se enchufa al AgentRunner como agente opencode (MemoryBackend)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const adapter = new OpencodeAdapter(
      () =>
        new ScriptedTransport([
          { kind: "text", text: "listo" },
          { kind: "result", outcome: "completed" },
        ]),
      noDiscover,
    );
    const runner = new AgentRunner(backend, machine.id, [adapter]);
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "opencode",
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
      new OpencodeAdapter(() => new StreamingTransport(), noDiscover),
    ]);
    await runner.start();
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "opencode",
      cwd: "/p",
      prompt: "hola",
    });
    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "oc: hola",
      ),
    );

    await backend.sendCommand({ type: "send_message", sessionId: session.id, text: "mundo" });
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "oc: mundo",
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

describe("OpencodeAdapter.capabilities", () => {
  it("refleja el descubrimiento y marca permisos/effort/uso soportados", async () => {
    const adapter = new OpencodeAdapter(() => new StreamingTransport(), async () => ({
      available: true,
      models: [
        { id: "opencode/claude-opus-4-8", label: "opencode/claude-opus-4-8" },
        { id: "opencode/deepseek-v4-flash-free", label: "opencode/deepseek-v4-flash-free" },
      ],
    }));
    const cap = await adapter.capabilities();
    expect(cap).toMatchObject({
      agentType: "opencode",
      available: true,
      supportsEffort: true,
      supportsPermissions: true,
      supportsUsage: true,
    });
    expect(cap.models).toHaveLength(2);
  });

  it("si opencode no está disponible, available=false y sin modelos", async () => {
    const cap = await new OpencodeAdapter(() => new StreamingTransport(), noDiscover).capabilities();
    expect(cap.available).toBe(false);
    expect(cap.models).toEqual([]);
  });
});

describe("parseModels (catálogo de opencode models)", () => {
  it("se queda solo con líneas provider/model e ignora ruido", () => {
    const raw = [
      "opencode/big-pickle",
      "opencode/claude-opus-4-8",
      "",
      "Available models:", // encabezado
      "  anthropic/claude-sonnet-4-6  ",
      "── separador ──",
    ].join("\n");
    expect(parseModels(raw)).toEqual([
      { id: "opencode/big-pickle", label: "opencode/big-pickle" },
      { id: "opencode/claude-opus-4-8", label: "opencode/claude-opus-4-8" },
      { id: "anthropic/claude-sonnet-4-6", label: "anthropic/claude-sonnet-4-6" },
    ]);
  });

  it("devuelve [] si no hay líneas válidas", () => {
    expect(parseModels("sin modelos\n---")).toEqual([]);
  });
});
