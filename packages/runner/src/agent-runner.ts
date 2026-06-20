import {
  boxSeal,
  isTerminalSessionStatus,
  sealToPublicKey,
  verifyCommandSignature,
  type AppendEventInput,
  type AgentType,
  type BackendPort,
  type Command,
  type Payload,
  type Session,
  type Unsubscribe,
} from "@batuta/protocol";
import type {
  AgentAdapter,
  AgentSession,
  PermissionDecision,
  PermissionRequest,
} from "./agent-adapter.js";

export interface AgentRunnerOptions {
  onError?: (err: unknown) => void;
  /** Tiempo máximo de espera de una decisión de permiso (ms). Por defecto 5 min. */
  permissionTimeoutMs?: number;
  /**
   * Clave pública (base64) que firma los comandos de confianza. Si se define, el
   * runner EXIGE firma válida en cada comando y rechaza los no firmados/alterados
   * (integridad ante cuenta/backend comprometidos). Si se omite, no hay exigencia.
   */
  signerPublicKey?: string;
  /**
   * Clave pública de cifrado (base64) de la app. Si se define, los diffs se
   * cifran extremo-a-extremo hacia la app (el backend no los ve). Si se omite,
   * los diffs viajan inline.
   */
  recipientBoxPublicKey?: string;
  /**
   * Clave privada de cifrado (base64) del runner. Si se define junto a
   * `recipientBoxPublicKey`, los diffs van cifrados Y autenticados (la app
   * verifica que vinieron de este runner). Si se omite, cifrado anónimo.
   */
  senderBoxSecretKey?: string;
}

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Orquesta el cableado runner↔backend: escucha los `commands` dirigidos a esta
 * máquina y los rutea al adaptador del agente, que emite `events`. Gestiona el
 * flujo de permisos (crear, emitir, bloquear, resolver, expirar) y hace catch-up
 * de comandos sin consumir al (re)suscribir (idempotencia + reconexión).
 */
export class AgentRunner {
  private readonly adapters = new Map<AgentType, AgentAdapter>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly processedCommands = new Set<string>();
  private readonly seenNonces = new Set<string>();
  private readonly onError: (err: unknown) => void;
  private readonly permissionTimeoutMs: number;
  private readonly signerPublicKey: string | undefined;
  private readonly recipientBoxPublicKey: string | undefined;
  private readonly senderBoxSecretKey: string | undefined;
  private unsubscribe: Unsubscribe | undefined;

  constructor(
    private readonly backend: BackendPort,
    private readonly machineId: string,
    adapters: AgentAdapter[],
    options: AgentRunnerOptions = {},
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.agentType, adapter);
    this.onError = options.onError ?? ((err) => console.error("agent-runner:", err));
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? 5 * 60 * 1_000;
    this.signerPublicKey = options.signerPublicKey;
    this.recipientBoxPublicKey = options.recipientBoxPublicKey;
    this.senderBoxSecretKey = options.senderBoxSecretKey;
  }

  /**
   * Arranca el runner. Primero reconcilia sesiones huérfanas (de una ejecución
   * anterior que murió), luego se suscribe a los comandos y, en cada
   * (re)suscripción, hace catch-up de los comandos perdidos durante el corte.
   */
  async start(): Promise<void> {
    await this.reconcileOrphans();
    await new Promise<void>((resolve) => {
      let ready = false;
      this.unsubscribe = this.backend.subscribeCommands(
        this.machineId,
        (command) => void this.handle(command),
        (status) => {
          if (status !== "SUBSCRIBED") return;
          // Realtime no reproduce lo perdido durante un corte: tras CADA
          // (re)suscripción recuperamos los comandos sin consumir. El dedup de
          // `handle` evita reprocesar (idempotencia).
          void this.catchUp();
          if (!ready) {
            ready = true;
            resolve();
          }
        },
      );
    });
  }

  /** Procesa los comandos sin consumir de esta máquina (catch-up). */
  private async catchUp(): Promise<void> {
    try {
      for (const command of await this.backend.listPendingCommands(this.machineId)) {
        void this.handle(command);
      }
    } catch (err) {
      this.onError(err);
    }
  }

  /**
   * Cierra las sesiones "huérfanas": las que quedaron en un estado no-terminal
   * porque el runner murió a media tarea. Al reiniciar ya no existe la sesión en
   * memoria (la conversación del SDK se perdió), así que no se pueden continuar;
   * las marcamos `error` y expiramos sus permisos pendientes para que la app no
   * las muestre eternamente "en curso".
   */
  private async reconcileOrphans(): Promise<void> {
    let sessions: Session[];
    try {
      sessions = await this.backend.listSessions();
    } catch (err) {
      this.onError(err);
      return;
    }
    const orphans = sessions.filter(
      (s) =>
        s.machineId === this.machineId &&
        !isTerminalSessionStatus(s.status) &&
        !this.sessions.has(s.id),
    );
    for (const session of orphans) {
      try {
        for (const permission of await this.backend.listPendingPermissions(session.id)) {
          await this.backend.resolvePermission(permission.id, "expired");
        }
        await this.backend.appendEvent({
          sessionId: session.id,
          type: "error",
          message: "Sesión interrumpida: el runner se reinició y no puede continuarla.",
        });
        await this.backend.updateSession(session.id, { status: "error" });
      } catch (err) {
        this.onError(err);
      }
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const { timer } of this.pendingPermissions.values()) clearTimeout(timer);
    this.pendingPermissions.clear();
    for (const session of this.sessions.values()) {
      try {
        await session.dispose();
      } catch (err) {
        this.onError(err);
      }
    }
    this.sessions.clear();
  }

  /**
   * ¿Aceptamos ejecutar este comando? Si hay clave de firma configurada, exige
   * firma válida y rechaza nonces repetidos (replay). Sin clave, acepta todo
   * (compatibilidad). Un comando rechazado se marca consumido y se descarta.
   */
  private accept(command: Command): boolean {
    if (!this.signerPublicKey) return true;
    if (!verifyCommandSignature(this.signerPublicKey, command)) {
      this.onError(new Error(`Comando ${command.id} rechazado: firma inválida o ausente`));
      return false;
    }
    if (command.nonce !== undefined) {
      if (this.seenNonces.has(command.nonce)) {
        this.onError(new Error(`Comando ${command.id} rechazado: nonce repetido (replay)`));
        return false;
      }
      this.seenNonces.add(command.nonce);
    }
    return true;
  }

  private async handle(command: Command): Promise<void> {
    if (this.processedCommands.has(command.id)) return; // dedup (catch-up + realtime)
    this.processedCommands.add(command.id);
    try {
      if (!this.accept(command)) return;
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
          requestPermission: (request) => this.requestPermission(session, request),
        });
        this.sessions.set(session.id, agentSession);
        // Refleja el prompt del usuario en el hilo. Se emite tras registrar la
        // sesión (para no abrir una ventana de carrera con un cancel inmediato);
        // los agentes reales responden de forma asíncrona, así que tu mensaje
        // aparece igualmente primero.
        await this.backend.appendEvent({
          sessionId: session.id,
          type: "message",
          role: "user",
          text: command.prompt,
        });
        break;
      }
      case "send_message": {
        const session = this.sessions.get(command.sessionId);
        // Sesión sin agente vivo (p. ej. el runner se reinició): no hay a quién
        // entregarle el mensaje. Se ignora en silencio (la sesión ya quedó
        // cerrada en la reconciliación de arranque).
        if (!session) return;
        // Refleja el mensaje del usuario en el hilo antes de pasarlo al agente.
        await this.backend.appendEvent({
          sessionId: command.sessionId,
          type: "message",
          role: "user",
          text: command.text,
        });
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
      case "reject": {
        const status = command.type === "approve" ? "approved" : "rejected";
        await this.backend.resolvePermission(command.permissionId, status).catch(this.onError);
        const pending = this.pendingPermissions.get(command.permissionId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingPermissions.delete(command.permissionId);
          pending.resolve(command.type === "approve" ? "allow" : "deny");
          await this.backend
            .updateSession(command.sessionId, { status: "running" })
            .catch(this.onError);
        }
        break;
      }
    }
  }

  /**
   * Crea un permiso persistente, emite `permission_required` y se bloquea hasta
   * que llegue un approve/reject (o expire, en cuyo caso deniega por defecto).
   */
  private async requestPermission(
    session: Session,
    request: PermissionRequest,
  ): Promise<PermissionDecision> {
    const diff: Payload | undefined = request.diff
      ? this.recipientBoxPublicKey
        ? this.senderBoxSecretKey
          ? boxSeal(request.diff, this.recipientBoxPublicKey, this.senderBoxSecretKey)
          : sealToPublicKey(request.diff, this.recipientBoxPublicKey)
        : { type: "inline", content: request.diff }
      : undefined;
    const permission = await this.backend.createPermission({
      sessionId: session.id,
      tool: request.tool,
      summary: request.title,
      ...(diff ? { diff } : {}),
      expiresAt: new Date(Date.now() + this.permissionTimeoutMs).toISOString(),
    });

    await this.backend.appendEvent({
      sessionId: session.id,
      type: "permission_required",
      permissionId: permission.id,
      tool: request.tool,
      summary: request.title,
      ...(diff ? { diff } : {}),
    });
    await this.backend
      .updateSession(session.id, { status: "waiting_permission" })
      .catch(this.onError);

    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(permission.id);
        void this.backend.resolvePermission(permission.id, "expired").catch(this.onError);
        resolve("deny");
      }, this.permissionTimeoutMs);
      timer.unref?.();
      this.pendingPermissions.set(permission.id, { resolve, timer });
    });
  }
}
