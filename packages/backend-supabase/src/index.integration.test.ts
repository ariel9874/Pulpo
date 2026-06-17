import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Event } from "@batuta/protocol";
import { createSupabaseBackend, SupabaseBackend } from "./index.js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(URL && SERVICE_KEY);

function adminClient(): SupabaseClient {
  return createClient(URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout (${ms}ms): ${label}`)), ms),
    ),
  ]);
}

// Estos tests requieren Supabase local (Docker) y se saltan si no hay entorno.
describe.skipIf(!hasEnv)("SupabaseBackend (integración — requiere Supabase local)", () => {
  let admin: SupabaseClient;
  let writer: SupabaseBackend;
  let reader: SupabaseBackend;
  let userId: string;
  let machineId: string;
  let sessionId: string;

  beforeAll(async () => {
    admin = adminClient();
    const email = `it-${Date.now()}@batuta.dev`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "password-123",
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    writer = createSupabaseBackend(URL!, SERVICE_KEY!, { userId });
    reader = createSupabaseBackend(URL!, SERVICE_KEY!, { userId });

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
    // Borrar el usuario cascada-elimina machine/session/events/commands.
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
    // Marcador único: ignoramos cualquier evento previo de la sesión y resolvemos
    // solo con el mensaje que insertamos en este test.
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
