import type { AgentCapability } from "@pulpo/protocol";
import type { AgentAdapter, AgentEvent, AgentSession, StartParams } from "../../agent-adapter.js";
import { MessageQueue } from "../../message-queue.js";
import { AgyCliTransport } from "./cli-transport.js";
import type { AntigravityMessage, AntigravityTransport } from "./transport.js";

export * from "./transport.js";
export { AgyCliTransport, discoverAgy, type AgyCliOptions } from "./cli-transport.js";

/** Opciones por tarea para el transporte (hoy: el modelo elegido en la app). */
export interface AntigravityTransportOptions {
  model?: string;
}
export type AntigravityTransportFactory = (
  options: AntigravityTransportOptions,
) => AntigravityTransport;

/** Traduce un mensaje del transporte a un evento del protocolo. */
function toEvent(message: AntigravityMessage): AgentEvent {
  switch (message.kind) {
    case "text":
      return { type: "message", role: "agent", text: message.text };
    case "thinking":
      return { type: "thought", text: message.text };
    case "tool_use":
      return { type: "tool_call", tool: message.tool, title: message.title, status: "started" };
    case "result":
      return { type: "task_done", outcome: message.outcome };
    case "error":
      return { type: "error", message: message.message };
  }
}

/**
 * Segundo adaptador (prueba de "universal"): lanza Antigravity vía su CLI `agy`
 * y mapea su actividad a eventos del protocolo. Demuestra que añadir un agente es
 * solo un adaptador — la misma forma que `ClaudeCodeAdapter`. El transporte es
 * inyectable: en tests se usa uno simulado (sin CLI ni red).
 */
export class AntigravityAdapter implements AgentAdapter {
  readonly agentType = "antigravity" as const;

  constructor(
    private readonly createTransport: AntigravityTransportFactory = (options) =>
      new AgyCliTransport(options),
  ) {}

  async capabilities(): Promise<AgentCapability> {
    return {
      agentType: this.agentType,
      label: "Antigravity",
      // Marcado NO disponible a propósito: se verificó que `agy` v1.0.10 no es
      // automatizable headless — `agy --print` no emite nada a un stdout
      // redirigido (solo renderiza a TTY interactiva), así que el runner no puede
      // capturar la respuesta. El cableado queda listo: reactivar a `true` cuando
      // su CLI tenga modo servidor/JSON o salida headless. Ver cli-transport.ts.
      available: false,
      models: [],
      supportsEffort: false,
      supportsPermissions: false,
      supportsUsage: false,
    };
  }

  async start(params: StartParams): Promise<AgentSession> {
    const controller = new AbortController();
    const input = new MessageQueue();
    input.push(params.prompt);
    const transport = this.createTransport({
      ...(params.session.model ? { model: params.session.model } : {}),
    });
    void this.pump(transport, params, input, controller);
    return new AntigravitySession(input, controller);
  }

  private async pump(
    transport: AntigravityTransport,
    params: StartParams,
    input: MessageQueue,
    controller: AbortController,
  ): Promise<void> {
    const { session, emit, requestPermission } = params;
    let sawResult = false;
    try {
      for await (const message of transport.run({
        input,
        cwd: session.cwd,
        signal: controller.signal,
        requestPermission,
      })) {
        await emit(toEvent(message));
        if (message.kind === "result") sawResult = true;
      }
      if (controller.signal.aborted) {
        await emit({ type: "task_done", outcome: "cancelled" });
      } else if (!sawResult) {
        await emit({ type: "task_done", outcome: "completed" });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        await emit({ type: "task_done", outcome: "cancelled" });
      } else {
        await emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

class AntigravitySession implements AgentSession {
  constructor(
    private readonly input: MessageQueue,
    private readonly controller: AbortController,
  ) {}

  async sendMessage(text: string): Promise<void> {
    this.input.push(text); // nuevo turno en el mismo cwd
  }

  async cancel(): Promise<void> {
    this.controller.abort();
    this.input.close();
  }

  async dispose(): Promise<void> {
    this.controller.abort();
    this.input.close();
  }
}
