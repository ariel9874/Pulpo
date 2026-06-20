import {
  createClient,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  commandSchema,
  deviceTokenSchema,
  eventSchema,
  machineSchema,
  permissionSchema,
  sessionSchema,
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

  async setMachineStatus(machineId: string, status: Machine["status"]): Promise<void> {
    const { error } = await this.client.from("machines").update({ status }).eq("id", machineId);
    if (error) throw error;
  }

  async listMachines(): Promise<Machine[]> {
    const { data, error } = await this.client
      .from("machines")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToMachine(r as Row));
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

  async deleteSession(id: string): Promise<void> {
    // Primero los artifacts de Storage: Supabase prohíbe borrar storage.objects
    // por SQL (cascade/trigger), hay que pasar por la Storage API. Lo hacemos antes
    // de borrar la fila para no dejar huérfanos si algo falla.
    await this.removeSessionArtifacts(id);
    // events/commands/permissions cuelgan de sessions con ON DELETE CASCADE,
    // así que esta única baja arrastra todo el hilo. RLS (sessions_own) ya
    // exige user_id = auth.uid(), de modo que solo borras lo tuyo.
    const { error } = await this.client.from("sessions").delete().eq("id", id);
    if (error) throw error;
  }

  /** Borra los archivos de `artifacts/<user_id>/<session_id>/` vía Storage API. */
  private async removeSessionArtifacts(sessionId: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    if (!userId) return;
    const prefix = `${userId}/${sessionId}`;
    const { data, error } = await this.client.storage
      .from("artifacts")
      .list(prefix, { limit: 1000 });
    if (error) throw error;
    // La convención de ruta es plana (<user>/<session>/<archivo>); `id === null`
    // serían subcarpetas, que no se pueden borrar por nombre: las ignoramos.
    const paths = (data ?? []).filter((o) => o.id !== null).map((o) => `${prefix}/${o.name}`);
    if (paths.length === 0) return;
    const { error: removeError } = await this.client.storage.from("artifacts").remove(paths);
    if (removeError) throw removeError;
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

  async listPendingCommands(machineId: string): Promise<Command[]> {
    const { data, error } = await this.client
      .from("commands")
      .select("*")
      .eq("machine_id", machineId)
      .is("consumed_at", null)
      .order("ts", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToCommand(r as Row));
  }

  // --- Permisos ---

  async createPermission(input: CreatePermissionInput): Promise<Permission> {
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from("permissions")
      .insert({
        user_id: userId,
        session_id: input.sessionId,
        status: "pending",
        tool: input.tool,
        summary: input.summary,
        diff: input.diff ?? null,
        expires_at: input.expiresAt ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToPermission(data as Row);
  }

  async resolvePermission(permissionId: string, status: PermissionStatus): Promise<Permission> {
    const { data, error } = await this.client
      .from("permissions")
      .update({ status, decided_at: new Date().toISOString() })
      .eq("id", permissionId)
      .select()
      .single();
    if (error) throw error;
    return rowToPermission(data as Row);
  }

  async listPendingPermissions(sessionId: string): Promise<Permission[]> {
    const { data, error } = await this.client
      .from("permissions")
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToPermission(r as Row));
  }

  // --- Tokens de dispositivo ---

  async registerDeviceToken(input: CreateDeviceTokenInput): Promise<DeviceToken> {
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from("device_tokens")
      .upsert(
        { user_id: userId, token: input.token, platform: input.platform },
        { onConflict: "user_id,token" },
      )
      .select()
      .single();
    if (error) throw error;
    return rowToDeviceToken(data as Row);
  }

  async listDeviceTokens(): Promise<DeviceToken[]> {
    const { data, error } = await this.client
      .from("device_tokens")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowToDeviceToken(r as Row));
  }
}

/**
 * Crea un `SupabaseBackend`. `key` es la clave para el gateway (anon o service).
 * Si se pasa `accessToken` (p. ej. el JWT del runner tras el pairing), se usa como
 * Authorization Bearer y como token de Realtime, manteniendo `key` como apikey.
 */
export function createSupabaseBackend(
  url: string,
  key: string,
  options: SupabaseBackendOptions & { accessToken?: string } = {},
): SupabaseBackend {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(options.accessToken
      ? { global: { headers: { Authorization: `Bearer ${options.accessToken}` } } }
      : {}),
  });
  // Fijar el token de Realtime: el rol del JWT determina la visibilidad de los
  // cambios (apply_rls comprueba has_column_privilege con ese rol).
  client.realtime.setAuth(options.accessToken ?? key);
  return new SupabaseBackend(client, { userId: options.userId });
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

function rowToDeviceToken(r: Row): DeviceToken {
  return deviceTokenSchema.parse({
    id: r.id,
    userId: r.user_id,
    token: r.token,
    platform: r.platform,
    createdAt: toIso(r.created_at),
  });
}

function rowToPermission(r: Row): Permission {
  return permissionSchema.parse({
    id: r.id,
    sessionId: r.session_id,
    status: r.status,
    tool: r.tool,
    summary: r.summary ?? "",
    diff: r.diff ? asObject(r.diff) : undefined,
    expiresAt: r.expires_at ? toIso(r.expires_at) : undefined,
    decidedAt: r.decided_at ? toIso(r.decided_at) : undefined,
    createdAt: toIso(r.created_at),
  });
}
