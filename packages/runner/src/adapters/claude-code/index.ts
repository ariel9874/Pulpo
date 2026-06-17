import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  EmitFn,
  StartParams,
} from "../../agent-adapter.js";
import { SdkClaudeTransport } from "./sdk-transport.js";
import type { ClaudeMessage, ClaudeTransport } from "./transport.js";

export * from "./transport.js";
export { SdkClaudeTransport } from "./sdk-transport.js";

export type ClaudeTransportFactory = () => ClaudeTransport;

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
      return { type: "task_done", outcome: message.outcome };
    case "error":
      return { type: "error", message: message.message };
  }
}

/**
 * Primer adaptador real: lanza Claude Code (vía el Claude Agent SDK por defecto)
 * y mapea su actividad a eventos del protocolo. El transporte es inyectable, así
 * que en tests se usa uno simulado sin gastar tokens.
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly agentType = "claude-code" as const;

  constructor(
    private readonly createTransport: ClaudeTransportFactory = () => new SdkClaudeTransport(),
  ) {}

  async start(params: StartParams): Promise<AgentSession> {
    const controller = new AbortController();
    const transport = this.createTransport();
    void this.pump(transport, params, controller);
    return new ClaudeCodeSession(controller, params.emit);
  }

  private async pump(
    transport: ClaudeTransport,
    params: StartParams,
    controller: AbortController,
  ): Promise<void> {
    const { prompt, session, emit } = params;
    let sawResult = false;
    try {
      for await (const message of transport.run({
        prompt,
        cwd: session.cwd,
        signal: controller.signal,
      })) {
        await emit(toEvent(message));
        if (message.kind === "result") sawResult = true;
      }
      if (!sawResult && !controller.signal.aborted) {
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
    private readonly controller: AbortController,
    private readonly emit: EmitFn,
  ) {}

  async sendMessage(text: string): Promise<void> {
    // Enviar mensajes a una sesión de Claude en curso llega en la Etapa 12.
    await this.emit({
      type: "message",
      role: "system",
      text: `Mensaje recibido ("${text.slice(0, 60)}"). El envío a una sesión de Claude en curso llega en la Etapa 12.`,
    });
  }

  async cancel(): Promise<void> {
    this.controller.abort();
  }

  async dispose(): Promise<void> {
    this.controller.abort();
  }
}
