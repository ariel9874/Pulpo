import type {
  AppendEventInput,
  AgentType,
  BackendPort,
  Command,
  Unsubscribe,
} from "@batuta/protocol";
import type { AgentAdapter, AgentSession } from "./agent-adapter.js";

export interface AgentRunnerOptions {
  onError?: (err: unknown) => void;
}

/**
 * Orquesta el cableado runner↔backend: escucha los `commands` dirigidos a esta
 * máquina y los rutea al adaptador del agente, que emite `events`. Marca cada
 * comando como consumido (idempotencia: no re-ejecutar al reconectar).
 */
export class AgentRunner {
  private readonly adapters = new Map<AgentType, AgentAdapter>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly onError: (err: unknown) => void;
  private unsubscribe: Unsubscribe | undefined;

  constructor(
    private readonly backend: BackendPort,
    private readonly machineId: string,
    adapters: AgentAdapter[],
    options: AgentRunnerOptions = {},
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.agentType, adapter);
    this.onError = options.onError ?? ((err) => console.error("agent-runner:", err));
  }

  /** Se suscribe a los comandos y resuelve cuando la suscripción está lista. */
  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.unsubscribe = this.backend.subscribeCommands(
        this.machineId,
        (command) => void this.handle(command),
        (status) => {
          if (status === "SUBSCRIBED") resolve();
        },
      );
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const session of this.sessions.values()) {
      try {
        await session.dispose();
      } catch (err) {
        this.onError(err);
      }
    }
    this.sessions.clear();
  }

  private async handle(command: Command): Promise<void> {
    try {
      await this.dispatch(command);
    } catch (err) {
      this.onError(err);
    } finally {
      await this.backend.markCommandConsumed(command.id).catch(this.onError);
    }
  }

  private async dispatch(command: Command): Promise<void> {
    switch (command.type) {
      case "new_task": {
        const adapter = this.adapters.get(command.agentType);
        if (!adapter) throw new Error(`No hay adaptador para el agente "${command.agentType}"`);
        const session = await this.backend.createSession({
          machineId: this.machineId,
          agentType: command.agentType,
          title: command.title ?? command.prompt.slice(0, 60),
          cwd: command.cwd,
          status: "running",
        });
        const agentSession = await adapter.start({
          session,
          prompt: command.prompt,
          emit: async (event) => {
            await this.backend.appendEvent({ ...event, sessionId: session.id } as AppendEventInput);
          },
        });
        this.sessions.set(session.id, agentSession);
        break;
      }
      case "send_message": {
        const session = this.sessions.get(command.sessionId);
        if (!session) throw new Error(`Sesión desconocida: ${command.sessionId}`);
        await session.sendMessage(command.text);
        break;
      }
      case "cancel": {
        const session = this.sessions.get(command.sessionId);
        if (!session) return;
        await session.cancel();
        await this.backend.updateSession(command.sessionId, { status: "cancelled" });
        break;
      }
      case "approve":
      case "reject":
        // Decisiones de permiso: Etapa 11 (adaptador Claude Code).
        break;
    }
  }
}
