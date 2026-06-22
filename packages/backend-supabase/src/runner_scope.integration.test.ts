import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseBackend, SupabaseBackend } from "./index.js";
import { claimPairing, PairingClient, type RunnerCredential } from "./pairing.js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const hasEnv = Boolean(URL && SERVICE_KEY && ANON_KEY);

const PASSWORD = "password-123";

// Etapa 21 — mínimo privilegio: el token del runner (acotado por `pulpo_machine_id`)
// solo accede a SU máquina, aunque el usuario tenga varias. Requiere Supabase local.
describe.skipIf(!hasEnv)("Mínimo privilegio del runner (token acotado por máquina)", () => {
  let admin: SupabaseClient;
  let appClient: SupabaseClient;
  let appBackend: SupabaseBackend;
  let userId: string;
  let cred1: RunnerCredential;
  let cred2: RunnerCredential;

  async function pairMachine(): Promise<RunnerCredential> {
    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    const credPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    await claimPairing(appClient, start.deviceCode);
    return credPromise;
  }

  /** Backend con el token acotado de un runner (como en producción tras el pairing). */
  function runnerBackend(cred: RunnerCredential): SupabaseBackend {
    return createSupabaseBackend(URL!, ANON_KEY!, { accessToken: cred.token, userId: cred.userId });
  }

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `scope-${Date.now()}-${Math.random().toString(36).slice(2)}@pulpo.dev`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    appClient = createClient(URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signErr } = await appClient.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (signErr) throw signErr;
    appBackend = new SupabaseBackend(appClient);

    // Mismo usuario, DOS máquinas emparejadas → dos tokens acotados distintos.
    cred1 = await pairMachine();
    cred2 = await pairMachine();
  }, 60_000);

  afterAll(async () => {
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it("solo ve su propia máquina, no las demás del mismo usuario", async () => {
    const runner1 = runnerBackend(cred1);
    const ids = (await runner1.listMachines()).map((m) => m.id);
    expect(ids).toContain(cred1.machineId);
    expect(ids).not.toContain(cred2.machineId);
    // La app, en cambio, ve ambas.
    const appIds = (await appBackend.listMachines()).map((m) => m.id);
    expect(appIds).toEqual(expect.arrayContaining([cred1.machineId, cred2.machineId]));
  });

  it("no ve sesiones/eventos de otra máquina ni puede escribir en ellas", async () => {
    const s1 = await appBackend.createSession({
      machineId: cred1.machineId,
      agentType: "echo",
      title: "m1",
      cwd: "/m1",
    });
    const s2 = await appBackend.createSession({
      machineId: cred2.machineId,
      agentType: "echo",
      title: "m2",
      cwd: "/m2",
    });
    await appBackend.appendEvent({
      sessionId: s2.id,
      type: "message",
      role: "agent",
      text: "secreto de m2",
    });

    const runner1 = runnerBackend(cred1);

    const visible = (await runner1.listSessions()).map((s) => s.id);
    expect(visible).toContain(s1.id);
    expect(visible).not.toContain(s2.id);

    // No lee eventos ajenos…
    expect(await runner1.listEvents(s2.id)).toHaveLength(0);
    // …ni puede colgar eventos en una sesión de otra máquina…
    await expect(
      runner1.appendEvent({ sessionId: s2.id, type: "message", role: "agent", text: "intruso" }),
    ).rejects.toThrow();
    // …ni crear sesiones en la máquina ajena.
    await expect(
      runner1.createSession({
        machineId: cred2.machineId,
        agentType: "echo",
        title: "x",
        cwd: "/x",
      }),
    ).rejects.toThrow();
  }, 30_000);

  it("no ve los tokens de push del usuario (son cosa de la app)", async () => {
    await appBackend.registerDeviceToken({
      token: `ExponentPushToken[${Date.now()}]`,
      platform: "android",
    });
    const runner1 = runnerBackend(cred1);
    expect(await runner1.listDeviceTokens()).toHaveLength(0);
    expect((await appBackend.listDeviceTokens()).length).toBeGreaterThan(0);
  }, 30_000);

  it("opera con normalidad sobre su propia máquina", async () => {
    const runner1 = runnerBackend(cred1);
    await runner1.heartbeat(cred1.machineId);
    const session = await runner1.createSession({
      machineId: cred1.machineId,
      agentType: "echo",
      title: "propia",
      cwd: "/ok",
    });
    const ev = await runner1.appendEvent({
      sessionId: session.id,
      type: "message",
      role: "agent",
      text: "hola",
    });
    expect(ev.sessionId).toBe(session.id);
  }, 30_000);
});
