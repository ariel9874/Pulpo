import { createRequire } from "node:module";
import type { AgentCapability } from "@batuta/protocol";
import type { AgentAdapter, AgentEvent, AgentSession, StartParams } from "../../agent-adapter.js";
import { MessageQueue } from "../../message-queue.js";
import { SdkClaudeTransport, type SdkTransportOptions } from "./sdk-transport.js";
import type { ClaudeMessage, ClaudeTransport } from "./transport.js";

export * from "./transport.js";
export { SdkClaudeTransport } from "./sdk-transport.js";

/** Crea un transporte para la tarea, con el modelo/effort elegidos (si los hay). */
export type ClaudeTransportFactory = (options: SdkTransportOptions) => ClaudeTransport;

/** Traduce un mensaje del transporte a un evento del protocolo. */
function toEvent(message: ClaudeMessage): AgentEvent {
  switch (message.kind) {
    case "text":
      return { type: "message", role: "agent", text: message.text };
    case "thinking":
      return { type: "thought", text: message.text };
    case "tool_use":
      return { type: "tool_call", tool: message.tool, title: message.title, status: "started" };
    case "result":
      return {
        type: "task_done",
        outcome: message.outcome,
        ...(message.summary ? { summary: message.summary } : {}),
      };
    case "error":
      return { type: "error", message: message.message };
  }
}

/**
 * Primer adaptador real: lanza Claude Code (vía el Claude Agent SDK por defecto)
 * y mapea su actividad a eventos del protocolo. El transporte es inyectable, así
 * que en tests se usa uno simulado sin gastar tokens.
 */
/** Catálogo curado de modelos Claude (ids que entiende el Agent SDK). */
const CLAUDE_MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
];

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly agentType = "claude-code" as const;

  async capabilities(): Promise<AgentCapability> {
    // "available" = el Agent SDK está instalado en esta PC (es una dep opcional).
    let available = true;
    try {
      createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
    } catch {
      available = false;
    }
    return {
      agentType: this.agentType,
      label: "Claude Code",
      available,
      models: CLAUDE_MODELS,
      supportsEffort: true,
      supportsPermissions: true,
      supportsUsage: true,
    };
  }

  constructor(
    private readonly createTransport: ClaudeTransportFactory = (options) =>
      new SdkClaudeTransport(options),
  ) {}

  async start(params: StartParams): Promise<AgentSession> {
    const controller = new AbortController();
    const input = new MessageQueue();
    input.push(params.prompt); // el prompt inicial es el primer mensaje
    // El modelo/effort de la sesión (elegidos en la app) mandan; si faltan, el
    // transporte aplica sus defaults explícitos.
    const transport = this.createTransport({
      ...(params.session.model ? { model: params.session.model } : {}),
      ...(params.session.effort ? { effort: params.session.effort } : {}),
    });
    void this.pump(transport, params, input, controller);
    return new ClaudeCodeSession(input, controller);
  }

  private async pump(
    transport: ClaudeTransport,
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
      // El stream terminó: si fue por cancelación, ciérralo como cancelado.
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

class ClaudeCodeSession implements AgentSession {
  constructor(
    private readonly input: MessageQueue,
    private readonly controller: AbortController,
  ) {}

  async sendMessage(text: string): Promise<void> {
    // Alimenta a la sesión de Claude en curso (modo de entrada en streaming).
    this.input.push(text);
  }

  async cancel(): Promise<void> {
    // Cancelación limpia: corta tras la operación en curso y cierra la entrada.
    this.controller.abort();
    this.input.close();
  }

  async dispose(): Promise<void> {
    this.controller.abort();
    this.input.close();
  }
}
