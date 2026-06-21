import type { AgentCapability } from "@batuta/protocol";
import type { AgentAdapter, AgentSession, EmitFn, StartParams } from "../agent-adapter.js";

/**
 * Adaptador de prueba: no usa IA. Devuelve como `message` lo que recibe, para
 * verificar todo el cableado runner↔backend sin depender de un agente real.
 */
export class EchoAdapter implements AgentAdapter {
  readonly agentType = "echo" as const;

  async capabilities(): Promise<AgentCapability> {
    return {
      agentType: this.agentType,
      label: "Echo (prueba)",
      available: true,
      models: [],
      supportsEffort: false,
      supportsPermissions: false,
      supportsUsage: false,
    };
  }

  async start(params: StartParams): Promise<AgentSession> {
    await params.emit({ type: "message", role: "agent", text: `echo: ${params.prompt}` });
    return new EchoSession(params.emit);
  }
}

class EchoSession implements AgentSession {
  constructor(private readonly emit: EmitFn) {}

  async sendMessage(text: string): Promise<void> {
    await this.emit({ type: "message", role: "agent", text: `echo: ${text}` });
  }

  async cancel(): Promise<void> {
    await this.emit({ type: "task_done", outcome: "cancelled" });
  }

  async dispose(): Promise<void> {
    // El eco no tiene recursos que liberar.
  }
}
