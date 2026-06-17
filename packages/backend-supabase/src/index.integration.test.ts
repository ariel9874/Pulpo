import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Event } from "@batuta/protocol";
import { SupabaseBackend } from "./index.js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const hasEnv = Boolean(URL && SERVICE_KEY && ANON_KEY);

const PASSWORD = "password-123";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout (${ms}ms): ${label}`)), ms),
    ),
  ]);
}

// Requiere Supabase local (Docker). Se usa un usuario autenticado real (rol
// authenticated) para que RLS y Realtime se comporten como en producción.
describe.skipIf(!hasEnv)("SupabaseBackend (integración — requiere Supabase local)", () => {
  let admin: SupabaseClient;
  let userId: string;
  let email: string;
  let writer: SupabaseBackend;
  let reader: SupabaseBackend;
  let machineId: string;
  let sessionId: string;

  async function signedInBackend(): Promise<SupabaseBackend> {
    const client = createClient(URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // signIn actualiza también el token de Realtime del cliente (rol authenticated).
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw error;
    return new SupabaseBackend(client, { userId });
  }

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    email = `it-${Date.now()}-${Math.random().toString(36).slice(2)}@batuta.dev`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    writer = await signedInBackend();
    reader = await signedInBackend();

    const machine = await writer.registerMachine({ name: "PC integración" });
    machineId = machine.id;
    const session = await writer.createSession({
      machineId,
      agentType: "echo",
      title: "Demo integración",
      cwd: "/tmp/demo",
    });
    sessionId = session.id;
  }, 30_000);

  afterAll(async () => {
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it("CRUD: la sesión creada aparece al listar y los eventos persisten", async () => {
    const sessions = await reader.listSessions();
    expect(sessions.some((s) => s.id === sessionId)).toBe(true);

    await writer.appendEvent({ sessionId, type: "thought", text: "pensando" });
    const events = await reader.listEvents(sessionId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)).toMatchObject({ type: "thought", sessionId });
  });

  it("un cliente inserta un evento y otro lo recibe por Realtime en < 1 s", async () => {
    // Marcador único: ignoramos cualquier evento previo y resolvemos solo con el
    // mensaje que insertamos en este test.
    const marker = `realtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let resolveReceived!: (event: Event) => void;
    const received = new Promise<Event>((resolve) => {
      resolveReceived = resolve;
    });

    // Suscribir el lector y esperar a que el canal esté establecido (SUBSCRIBED).
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no SUBSCRIBED a tiempo")), 10_000);
      reader.subscribeEvents(
        sessionId,
        (event) => {
          if (event.type === "message" && event.text === marker) resolveReceived(event);
        },
        (status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve();
          }
        },
      );
    });
    await ready;

    // Medir la latencia inserción → recepción por Realtime.
    const t0 = Date.now();
    const appended = await writer.appendEvent({
      sessionId,
      type: "message",
      role: "agent",
      text: marker,
    });
    const event = await withTimeout(received, 5_000, "evento por Realtime");
    const latencyMs = Date.now() - t0;

    expect(event.id).toBe(appended.id);
    expect(event).toMatchObject({ sessionId, type: "message", protocolVersion: 1 });
    expect(latencyMs).toBeLessThan(1_000);
  }, 20_000);
});
