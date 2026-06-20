import {
  commandSchema,
  deviceTokenSchema,
  eventSchema,
  machineSchema,
  permissionSchema,
  sessionSchema,
  PROTOCOL_VERSION,
  type AppendEventInput,
  type BackendPort,
  type Command,
  type CreateDeviceTokenInput,
  type CreatePermissionInput,
  type CreateSessionInput,
  type DeviceToken,
  type Event,
  type Machine,
  type Permission,
  type PermissionStatus,
  type RegisterMachineInput,
  type SendCommandInput,
  type Session,
  type SubscriptionStatusHandler,
  type Unsubscribe,
  type UpdateSessionInput,
} from "@batuta/protocol";

export interface MemoryBackendOptions {
  /** Usuario "autenticado" del fake. Por defecto un UUID fijo. */
  userId?: string;
}

/**
 * Implementación en memoria de `BackendPort`. Todo en RAM, sin red ni Supabase.
 *
 * Sirve como doble de prueba fiel para testear runner, adaptadores y app: valida
 * en los bordes con los mismos schemas zod del protocolo y entrega las
 * suscripciones de forma asíncrona, imitando Realtime.
 */
export class MemoryBackend implements BackendPort {
  private readonly userId: string;

  private readonly machines = new Map<string, Machine>();
  private readonly sessions = new Map<string, Session>();
  private readonly eventsBySession = new Map<string, Event[]>();
  private readonly commandsById = new Map<string, Command>();
  private readonly consumedCommands = new Set<string>();
  private readonly permissions = new Map<string, Permission>();
  private readonly deviceTokens = new Map<string, DeviceToken>();

  private readonly eventSubs = new Map<string, Set<(event: Event) => void>>();
  private readonly sessionSubs = new Set<(session: Session) => void>();
  private readonly commandSubs = new Map<string, Set<(command: Command) => void>>();
  private readonly commandStatusSubs = new Map<string, Set<SubscriptionStatusHandler>>();
  private readonly offlineMachines = new Set<string>();

  constructor(options: MemoryBackendOptions = {}) {
    this.userId = options.userId ?? "00000000-0000-4000-8000-000000000000";
  }

  // --- Auth ---

  async getCurrentUserId(): Promise<string | null> {
    return this.userId;
  }

  // --- Máquinas ---

  async registerMachine(input: RegisterMachineInput): Promise<Machine> {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const previous = this.machines.get(id);
    const machine = machineSchema.parse({
      id,
      userId: this.userId,
      name: input.name,
      status: "online",
      lastSeen: now,
      createdAt: previous?.createdAt ?? now,
    });
    this.machines.set(id, machine);
    return machine;
  }

  async heartbeat(machineId: string): Promise<void> {
    const machine = this.machines.get(machineId);
    if (!machine) throw new Error(`Máquina desconocida: ${machineId}`);
    this.machines.set(machineId, {
      ...machine,
      status: "online",
      lastSeen: new Date().toISOString(),
    });
  }

  async setMachineStatus(machineId: string, status: Machine["status"]): Promise<void> {
    const machine = this.machines.get(machineId);
    if (!machine) throw new Error(`Máquina desconocida: ${machineId}`);
    this.machines.set(machineId, { ...machine, status });
  }

  async listMachines(): Promise<Machine[]> {
    return [...this.machines.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // --- Sesiones ---

  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = new Date().toISOString();
    const session = sessionSchema.parse({
      id: crypto.randomUUID(),
      machineId: input.machineId,
      agentType: input.agentType,
      title: input.title,
      status: input.status ?? "starting",
      cwd: input.cwd,
      createdAt: now,
      updatedAt: now,
    });
    this.sessions.set(session.id, session);
    this.eventsBySession.set(session.id, []);
    this.emitSession(session);
    return session;
  }

  async updateSession(id: string, patch: UpdateSessionInput): Promise<Session> {
    const current = this.sessions.get(id);
    if (!current) throw new Error(`Sesión desconocida: ${id}`);
    const updated = sessionSchema.parse({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.sessions.set(id, updated);
    this.emitSession(updated);
    return updated;
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteSession(id: string): Promise<void> {
    // Imita el ON DELETE CASCADE de la BD: la sesión y todo lo que cuelga de ella.
    this.sessions.delete(id);
    this.eventsBySession.delete(id);
    for (const [cid, command] of this.commandsById) {
      if ("sessionId" in command && command.sessionId === id) {
        this.commandsById.delete(cid);
        this.consumedCommands.delete(cid);
      }
    }
    for (const [pid, permission] of this.permissions) {
      if (permission.sessionId === id) this.permissions.delete(pid);
    }
  }

  subscribeSessions(
    handler: (session: Session) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe {
    this.sessionSubs.add(handler);
    queueMicrotask(() => onStatus?.("SUBSCRIBED"));
    return () => this.sessionSubs.delete(handler);
  }

  // --- Eventos ---

  async appendEvent(input: AppendEventInput): Promise<Event> {
    const event = eventSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
    });
    const list = this.eventsBySession.get(event.sessionId) ?? [];
    list.push(event);
    this.eventsBySession.set(event.sessionId, list);
    this.emitEvent(event);
    return event;
  }

  async listEvents(sessionId: string): Promise<Event[]> {
    return [...(this.eventsBySession.get(sessionId) ?? [])];
  }

  subscribeEvents(
    sessionId: string,
    handler: (event: Event) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe {
    const set = this.eventSubs.get(sessionId) ?? new Set();
    set.add(handler);
    this.eventSubs.set(sessionId, set);
    queueMicrotask(() => onStatus?.("SUBSCRIBED"));
    return () => set.delete(handler);
  }

  // --- Comandos ---

  async sendCommand(input: SendCommandInput): Promise<Command> {
    const command = commandSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
    });
    this.commandsById.set(command.id, command);
    const machineId = this.resolveMachineId(command);
    if (machineId) this.emitCommand(machineId, command);
    return command;
  }

  subscribeCommands(
    machineId: string,
    handler: (command: Command) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe {
    const set = this.commandSubs.get(machineId) ?? new Set();
    set.add(handler);
    this.commandSubs.set(machineId, set);
    const statusSet = this.commandStatusSubs.get(machineId) ?? new Set();
    if (onStatus) statusSet.add(onStatus);
    this.commandStatusSubs.set(machineId, statusSet);
    queueMicrotask(() => onStatus?.("SUBSCRIBED"));
    return () => {
      set.delete(handler);
      if (onStatus) statusSet.delete(onStatus);
    };
  }

  /**
   * Solo para tests: simula un corte de red. Los comandos enviados durante el
   * corte se guardan (quedan pendientes) pero NO se entregan en vivo, igual que
   * cuando se cae el websocket de Realtime.
   */
  simulateOutage(machineId: string): void {
    this.offlineMachines.add(machineId);
  }

  /**
   * Solo para tests: simula que Realtime se cayó y volvió, re-disparando
   * `SUBSCRIBED` (como hace supabase-js al re-unirse al canal). El runner usa
   * esa señal para hacer catch-up de los comandos perdidos durante el corte.
   */
  simulateReconnect(machineId: string): void {
    this.offlineMachines.delete(machineId);
    for (const onStatus of [...(this.commandStatusSubs.get(machineId) ?? [])]) {
      onStatus("SUBSCRIBED");
    }
  }

  async markCommandConsumed(commandId: string): Promise<void> {
    this.consumedCommands.add(commandId);
  }

  /** Solo para tests: ¿se marcó este comando como procesado? */
  isCommandConsumed(commandId: string): boolean {
    return this.consumedCommands.has(commandId);
  }

  async listPendingCommands(machineId: string): Promise<Command[]> {
    return [...this.commandsById.values()]
      .filter((c) => !this.consumedCommands.has(c.id) && this.resolveMachineId(c) === machineId)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }

  // --- Permisos ---

  async createPermission(input: CreatePermissionInput): Promise<Permission> {
    const permission = permissionSchema.parse({
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      status: "pending",
      tool: input.tool,
      summary: input.summary,
      diff: input.diff,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    });
    this.permissions.set(permission.id, permission);
    return permission;
  }

  async resolvePermission(permissionId: string, status: PermissionStatus): Promise<Permission> {
    const current = this.permissions.get(permissionId);
    if (!current) throw new Error(`Permiso desconocido: ${permissionId}`);
    const updated = permissionSchema.parse({
      ...current,
      status,
      decidedAt: new Date().toISOString(),
    });
    this.permissions.set(permissionId, updated);
    return updated;
  }

  async listPendingPermissions(sessionId: string): Promise<Permission[]> {
    return [...this.permissions.values()].filter(
      (p) => p.sessionId === sessionId && p.status === "pending",
    );
  }

  // --- Tokens de dispositivo ---

  async registerDeviceToken(input: CreateDeviceTokenInput): Promise<DeviceToken> {
    const existing = [...this.deviceTokens.values()].find(
      (t) => t.userId === this.userId && t.token === input.token,
    );
    if (existing) {
      const updated = deviceTokenSchema.parse({ ...existing, platform: input.platform });
      this.deviceTokens.set(updated.id, updated);
      return updated;
    }
    const token = deviceTokenSchema.parse({
      id: crypto.randomUUID(),
      userId: this.userId,
      token: input.token,
      platform: input.platform,
      createdAt: new Date().toISOString(),
    });
    this.deviceTokens.set(token.id, token);
    return token;
  }

  async listDeviceTokens(): Promise<DeviceToken[]> {
    return [...this.deviceTokens.values()].filter((t) => t.userId === this.userId);
  }

  // --- Helpers internos ---

  /** A qué máquina va dirigido un comando (new_task lo dice; el resto, vía su sesión). */
  private resolveMachineId(command: Command): string | undefined {
    if (command.type === "new_task") return command.machineId;
    return this.sessions.get(command.sessionId)?.machineId;
  }

  private emitEvent(event: Event): void {
    const subs = this.eventSubs.get(event.sessionId);
    if (!subs) return;
    for (const handler of [...subs]) queueMicrotask(() => handler(event));
  }

  private emitSession(session: Session): void {
    for (const handler of [...this.sessionSubs]) queueMicrotask(() => handler(session));
  }

  private emitCommand(machineId: string, command: Command): void {
    if (this.offlineMachines.has(machineId)) return; // corte simulado: queda pendiente
    const subs = this.commandSubs.get(machineId);
    if (!subs) return;
    for (const handler of [...subs]) queueMicrotask(() => handler(command));
  }
}
