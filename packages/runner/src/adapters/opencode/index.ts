import type { AgentCapability } from "@pulpo/protocol";
import type { AgentAdapter, AgentEvent, AgentSession, StartParams } from "../../agent-adapter.js";
import { MessageQueue } from "../../message-queue.js";
import { discoverOpencode, type OpencodeDiscovery } from "./discover.js";
import { SdkOpencodeTransport } from "./sdk-transport.js";
import type { OpencodeMessage, OpencodeTransport } from "./transport.js";

export * from "./transport.js";
export { discoverOpencode, parseModels, type OpencodeDiscovery } from "./discover.js";
export { SdkOpencodeTransport } from "./sdk-transport.js";
export { disposeOpencodeServer } from "./server.js";

/** Opciones por tarea para el transporte (el modelo elegido en la app). */
export interface OpencodeTransportOptions {
  model?: string;
}
export type OpencodeTransportFactory = (options: OpencodeTransportOptions) => OpencodeTransport;

/** Traduce un mensaje del transporte a un evento del protocolo. */
function toEvent(message: OpencodeMessage): AgentEvent {
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
 * Adaptador de opencode (tier rico): habla con el servidor de opencode vía su SDK
 * (que el transporte real levanta y cierra). Soporta eventos en vivo, gating de
 * permisos real y catálogo multi-modelo. El transporte es inyectable: en tests se
 * usa uno simulado (sin servidor ni red).
 */
export class OpencodeAdapter implements AgentAdapter {
  readonly agentType = "opencode" as const;

  constructor(
    private readonly createTransport: OpencodeTransportFactory = (options) =>
      new SdkOpencodeTransport(options),
    /** Descubrimiento de opencode (inyectable en tests para no lanzar el CLI real). */
    private readonly discover: () => Promise<OpencodeDiscovery> = () => discoverOpencode(),
  ) {}

  async capabilities(): Promise<AgentCapability> {
    const { available, models } = await this.discover();
    return {
      agentType: this.agentType,
      label: "opencode",
      available,
      models,
      // Gating de permisos real (lo cableamos vía permission.updated). El effort y
      // el uso/tokens aún no se exponen por esta vía del API; se revisitan luego.
      supportsEffort: false,
      supportsPermissions: true,
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
    return new OpencodeSession(input, controller);
  }

  private async pump(
    transport: OpencodeTransport,
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

class OpencodeSession implements AgentSession {
  constructor(
    private readonly input: MessageQueue,
    private readonly controller: AbortController,
  ) {}

  async sendMessage(text: string): Promise<void> {
    this.input.push(text); // nuevo turno en la misma sesión de opencode
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
