import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseBackend } from "./index.js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const hasEnv = Boolean(URL && SERVICE_KEY && ANON_KEY);

const PASSWORD = "password-123";

// Requiere Supabase local con RLS aplicada; se salta si no hay entorno.
describe.skipIf(!hasEnv)("RLS — aislamiento entre usuarios (requiere Supabase local)", () => {
  let admin: SupabaseClient;
  const createdUserIds: string[] = [];

  async function makeUserBackend(
    label: string,
  ): Promise<{ backend: SupabaseBackend; userId: string }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@batuta.dev`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    createdUserIds.push(data.user.id);

    // Cliente autenticado como ese usuario (rol authenticated → RLS aplica).
    const client = createClient(URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signErr) throw signErr;

    return { backend: new SupabaseBackend(client), userId: data.user.id };
  }

  beforeAll(() => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("el usuario B no puede leer ni escribir nada del usuario A", async () => {
    const a = await makeUserBackend("a");
    const b = await makeUserBackend("b");

    // A crea sus datos.
    const machineA = await a.backend.registerMachine({ name: "PC de A" });
    const sessionA = await a.backend.createSession({
      machineId: machineA.id,
      agentType: "echo",
      title: "Sesión de A",
      cwd: "/a",
    });
    await a.backend.appendEvent({
      sessionId: sessionA.id,
      type: "message",
      role: "agent",
      text: "secreto de A",
    });

    // B NO ve las sesiones ni eventos de A.
    const bSessions = await b.backend.listSessions();
    expect(bSessions.find((s) => s.id === sessionA.id)).toBeUndefined();
    expect(await b.backend.listEvents(sessionA.id)).toHaveLength(0);

    // B NO puede modificar la sesión de A (RLS oculta la fila → update no afecta nada).
    await expect(b.backend.updateSession(sessionA.id, { title: "hackeado" })).rejects.toThrow();

    // B NO puede colgar eventos en la sesión de A (with check de propiedad falla).
    await expect(
      b.backend.appendEvent({
        sessionId: sessionA.id,
        type: "message",
        role: "agent",
        text: "intruso",
      }),
    ).rejects.toThrow();

    // A sigue viendo su sesión intacta.
    const aSessions = await a.backend.listSessions();
    expect(aSessions.find((s) => s.id === sessionA.id)?.title).toBe("Sesión de A");
    expect(await a.backend.listEvents(sessionA.id)).toHaveLength(1);
  }, 30_000);

  it("cada usuario solo ve sus propias sesiones al listar", async () => {
    const a = await makeUserBackend("a2");
    const b = await makeUserBackend("b2");

    const mA = await a.backend.registerMachine({ name: "A2" });
    await a.backend.createSession({ machineId: mA.id, agentType: "echo", title: "sA", cwd: "/a" });
    const mB = await b.backend.registerMachine({ name: "B2" });
    await b.backend.createSession({ machineId: mB.id, agentType: "echo", title: "sB", cwd: "/b" });

    const aTitles = (await a.backend.listSessions()).map((s) => s.title);
    const bTitles = (await b.backend.listSessions()).map((s) => s.title);
    expect(aTitles).toContain("sA");
    expect(aTitles).not.toContain("sB");
    expect(bTitles).toContain("sB");
    expect(bTitles).not.toContain("sA");
  }, 30_000);
});
