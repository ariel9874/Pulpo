import {
  createClient,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  commandSchema,
  eventSchema,
  machineSchema,
  sessionSchema,
  type AppendEventInput,
  type BackendPort,
  type Command,
  type CreateSessionInput,
  type Event,
  type Machine,
  type RegisterMachineInput,
  type SendCommandInput,
  type Session,
  type Unsubscribe,
  type UpdateSessionInput,
} from "@batuta/protocol";

export * from "./pairing.js";

/** Callback opcional de estado de una suscripción Realtime (útil en tests). */
export type SubscriptionStatusHandler = (status: string) => void;

export interface SupabaseBackendOptions {
  /**
   * Usuario a usar en los INSERT (user_id). Si se omite, se toma de la sesión
   * de auth del cliente. El runner lo inyecta tras el pairing; la app lo deja
   * vacío y usa su sesión de auth.
   */
  userId?: string;
}

type Row = Record<string, unknown>;

/** Implementación real de `BackendPort` sobre supabase-js (Postgres + Realtime). */
export class SupabaseBackend implements BackendPort {
  constructor(
    private readonly client: SupabaseClient,
    private readonly options: SupabaseBackendOptions = {},
  ) {}

  // --- Auth ---

  async getCurrentUserId(): Promise<string | null> {
    if (this.options.userId) return this.options.userId;
    const { data } = await this.client.auth.getUser();
    return data.user?.id ?? null;
  }

  private async requireUserId(): Promise<string> {
    const id = await this.getCurrentUserId();
    if (!id) throw new Error("SupabaseBackend: no hay usuario autenticado");
    return id;
  }

  // --- Máquinas ---

  async registerMachine(input: RegisterMachineInput): Promise<Machine> {
    const userId = await this.requireUserId();
    const now = new Date().toISOString();
    const query = input.id
      ? this.client
          .from("machines")
          .upsert({
            id: input.id,
            user_id: userId,
            name: input.name,
            status: "online",
            last_seen: now,
          })
          .select()
          .single()
      : this.client
          .from("machines")
          .insert({ user_id: userId, name: input.name, status: "online", last_seen: now })
          .select()
          .single();
    const { data, error } = await query;
    if (error) throw error;
    return rowToMachine(data as Row);
  }

  async heartbeat(machineId: string): Promise<void> {
    const { error } = await this.client
      .from("machines")
      .update({ status: "online", last_seen: new Date().toISOString() })
      .eq("id", machineId);
    if (error) throw error;
  }

  // --- Sesiones ---

  async createSession(input: CreateSessionInput): Promise<Session> {
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from("sessions")
      .insert({
        user_id: userId,
        machine_id: input.machineId,
        agent_type: input.agentType,
        title: input.title,
        status: input.status ?? "starting",
        cwd: input.cwd,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToSession(data as Row);
  }

  async updateSession(id: string, patch: UpdateSessionInput): Promise<Session> {
    const update: Row = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.status !== undefined) update.status = patch.status;
    const { data, error } = await this.client
      .from("sessions")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToSession(data as Row);
  }

  async listSessions(): Promise<Session[]> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToSession(r as Row));
  }

  subscribeSessions(
    handler: (session: Session) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe {
    const channel = this.client
      .channel(`sessions-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions" },
        (payload: RealtimePostgresChangesPayload<Row>) => {
          const row = payload.new as Row;
          if (row && Object.keys(row).length > 0) handler(rowToSession(row));
        },
      )
      .subscribe((status) => onStatus?.(status));
    return () => void this.client.removeChannel(channel);
  }

  // --- Eventos ---

  async appendEvent(input: AppendEventInput): Promise<Event> {
    const userId = await this.requireUserId();
    const { sessionId, type, data } = splitEnvelope(input, ["sessionId"]);
    const { data: row, error } = await this.client
      .from("events")
      .insert({ user_id: userId, session_id: sessionId, type, data })
      .select()
      .single();
    if (error) throw error;
    return rowToEvent(row as Row);
  }

  async listEvents(sessionId: string): Promise<Event[]> {
    const { data, error } = await this.client
      .from("events")
      .select("*")
      .eq("session_id", sessionId)
      .order("ts", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToEvent(r as Row));
  }

  subscribeEvents(
    sessionId: string,
    handler: (event: Event) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe {
    const channel = this.client
      .channel(`events-${sessionId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload: RealtimePostgresChangesPayload<Row>) => handler(rowToEvent(payload.new as Row)),
      )
      .subscribe((status) => onStatus?.(status));
    return () => void this.client.removeChannel(channel);
  }

  // --- Comandos ---

  async sendCommand(input: SendCommandInput): Promise<Command> {
    const userId = await this.requireUserId();
    const { sessionId, machineId, type, data } = splitEnvelope(input, ["sessionId", "machineId"]);
    // Denormalizamos machine_id para poder filtrar comandos por máquina en Realtime.
    let resolvedMachineId = machineId ?? null;
    if (!resolvedMachineId && sessionId) {
      const { data: s } = await this.client
        .from("sessions")
        .select("machine_id")
        .eq("id", sessionId)
        .single();
      resolvedMachineId = ((s as Row | null)?.machine_id as string | undefined) ?? null;
    }
    const { data: row, error } = await this.client
      .from("commands")
      .insert({
        user_id: userId,
        session_id: sessionId ?? null,
        machine_id: resolvedMachineId,
        type,
        data,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToCommand(row as Row);
  }

  subscribeCommands(
    machineId: string,
    handler: (command: Command) => void,
    onStatus?: SubscriptionStatusHandler,
  ): Unsubscribe {
    const channel = this.client
      .channel(`commands-${machineId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "commands",
          filter: `machine_id=eq.${machineId}`,
        },
        (payload: RealtimePostgresChangesPayload<Row>) => handler(rowToCommand(payload.new as Row)),
      )
      .subscribe((status) => onStatus?.(status));
    return () => void this.client.removeChannel(channel);
  }

  async markCommandConsumed(commandId: string): Promise<void> {
    const { error } = await this.client
      .from("commands")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", commandId);
    if (error) throw error;
  }
}

/** Crea un `SupabaseBackend` a partir de URL + clave (crea el cliente por dentro). */
export function createSupabaseBackend(
  url: string,
  key: string,
  options: SupabaseBackendOptions = {},
): SupabaseBackend {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Fijar el token de Realtime: el rol del JWT determina la visibilidad de los
  // cambios (apply_rls comprueba has_column_privilege con ese rol).
  client.realtime.setAuth(key);
  return new SupabaseBackend(client, options);
}

// =====================================================================
// Mapeo fila (snake_case) ↔ protocolo (camelCase)
// =====================================================================

/** Coacciona un timestamp (formato PostgREST o de Realtime) a ISO-8601 con `Z`. */
function toIso(value: unknown): string {
  return new Date(value as string).toISOString();
}

/** jsonb puede llegar como objeto (PostgREST) o como string (algunos payloads Realtime). */
function asObject(value: unknown): Row {
  if (typeof value === "string") return JSON.parse(value) as Row;
  return (value as Row | null | undefined) ?? {};
}

/** Separa los campos de envelope (los que viven en columnas) del resto (que va a `data`). */
function splitEnvelope<T extends { type: string }>(
  input: T,
  columns: readonly string[],
): { type: string; sessionId?: string; machineId?: string; data: Row } {
  const rest = { ...(input as unknown as Row) };
  const type = rest.type as string;
  delete rest.type;
  const extracted: { sessionId?: string; machineId?: string } = {};
  for (const col of columns) {
    if (col in rest) {
      (extracted as Row)[col] = rest[col];
      delete rest[col];
    }
  }
  return { type, ...extracted, data: rest };
}

function rowToMachine(r: Row): Machine {
  return machineSchema.parse({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    status: r.status,
    lastSeen: toIso(r.last_seen),
    createdAt: toIso(r.created_at),
  });
}

function rowToSession(r: Row): Session {
  return sessionSchema.parse({
    id: r.id,
    machineId: r.machine_id,
    agentType: r.agent_type,
    title: r.title,
    status: r.status,
    cwd: r.cwd,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  });
}

function rowToEvent(r: Row): Event {
  return eventSchema.parse({
    id: r.id,
    sessionId: r.session_id,
    protocolVersion: r.protocol_version,
    ts: toIso(r.ts),
    type: r.type,
    ...asObject(r.data),
  });
}

function rowToCommand(r: Row): Command {
  const base: Row = {
    id: r.id,
    protocolVersion: r.protocol_version,
    ts: toIso(r.ts),
    type: r.type,
    ...asObject(r.data),
  };
  if (r.session_id) base.sessionId = r.session_id;
  if (r.machine_id) base.machineId = r.machine_id;
  return commandSchema.parse(base);
}
