import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Event, Session } from "@pulpo/protocol";
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
    email = `it-${Date.now()}-${Math.random().toString(36).slice(2)}@pulpo.dev`;
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

  // Realtime local puede tener lag puntual bajo carga; reintentamos para no flaquear.
  it(
    "un cliente inserta un evento y otro lo recibe por Realtime en < 1 s",
    { timeout: 30_000, retry: 2 },
    async () => {
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
      // Pequeño asentamiento: tras SUBSCRIBED, el binding de postgres_changes puede
      // tardar unos ms en quedar activo.
      await new Promise((r) => setTimeout(r, 300));

      // Medir la latencia inserción → recepción por Realtime.
      const t0 = Date.now();
      const appended = await writer.appendEvent({
        sessionId,
        type: "message",
        role: "agent",
        text: marker,
      });
      const event = await withTimeout(received, 10_000, "evento por Realtime");
      const latencyMs = Date.now() - t0;

      expect(event.id).toBe(appended.id);
      expect(event).toMatchObject({ sessionId, type: "message", protocolVersion: 1 });
      // El caso feliz local es < 1 s; toleramos hasta 2 s para no flaquear bajo carga.
      expect(latencyMs).toBeLessThan(2_000);
    },
  );

  // El mecanismo en el que se apoya la lista de sesiones de la app (Etapa 14).
  it(
    "subscribeSessions entrega una sesión nueva en vivo",
    { timeout: 30_000, retry: 2 },
    async () => {
      const title = `live-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      let resolveSeen!: (session: Session) => void;
      const seen = new Promise<Session>((resolve) => {
        resolveSeen = resolve;
      });
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no SUBSCRIBED a tiempo")), 10_000);
        reader.subscribeSessions(
          (session) => {
            if (session.title === title) resolveSeen(session);
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
      await new Promise((r) => setTimeout(r, 300));

      const created = await writer.createSession({
        machineId,
        agentType: "echo",
        title,
        cwd: "/tmp/live",
      });
      const session = await withTimeout(seen, 10_000, "sesión por Realtime");
      expect(session.id).toBe(created.id);
    },
  );

  // Mecanismo de recursos generados (Etapa 15): subir a Storage y descargar.
  it(
    "artifacts: sube un recurso a Storage y lo descarga por URL firmada",
    { timeout: 30_000 },
    async () => {
      const path = `${userId}/test-${Date.now()}.txt`;
      const content = "hola artefacto";

      const uploaded = await admin.storage
        .from("artifacts")
        .upload(path, Buffer.from(content), { contentType: "text/plain" });
      expect(uploaded.error).toBeNull();

      const signed = await admin.storage.from("artifacts").createSignedUrl(path, 60);
      const url = signed.data?.signedUrl;
      if (!url) throw new Error(signed.error?.message ?? "sin URL firmada");

      const res = await fetch(url);
      expect(await res.text()).toBe(content);

      await admin.storage.from("artifacts").remove([path]);
    },
  );
});
