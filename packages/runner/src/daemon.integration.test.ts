import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PairingClient,
  claimPairing,
  createSupabaseBackend,
  type RunnerCredential,
} from "@batuta/backend-supabase";
import { isMachineOnline, type Machine } from "@batuta/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RunnerDaemon } from "./daemon.js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const hasEnv = Boolean(URL && SERVICE_KEY && ANON_KEY);

const PASSWORD = "password-123";

describe.skipIf(!hasEnv)("RunnerDaemon (integración — credencial real)", () => {
  let admin: SupabaseClient;
  let userId: string;
  let credential: RunnerCredential;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `daemon-${Date.now()}-${Math.random().toString(36).slice(2)}@batuta.dev`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    // Emparejar como en producción para obtener la credencial del runner.
    const appClient = createClient(URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signErr } = await appClient.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (signErr) throw signErr;

    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    const credPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    await claimPairing(appClient, start.deviceCode);
    credential = await credPromise;
  }, 30_000);

  afterAll(async () => {
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it("usa la credencial: la máquina pasa a online y, al parar, a offline", async () => {
    const backend = createSupabaseBackend(credential.url, credential.anonKey, {
      accessToken: credential.token,
      userId: credential.userId,
    });
    const findMachine = async (): Promise<Machine> => {
      const machine = (await backend.listMachines()).find((m) => m.id === credential.machineId);
      if (!machine) throw new Error("máquina no encontrada");
      return machine;
    };

    const daemon = new RunnerDaemon(backend, credential.machineId, { heartbeatIntervalMs: 300 });
    await daemon.start();

    const online = await findMachine();
    expect(online.status).toBe("online");
    expect(isMachineOnline(online)).toBe(true);

    // El heartbeat refresca lastSeen.
    const seen1 = (await findMachine()).lastSeen;
    await new Promise((r) => setTimeout(r, 800));
    const seen2 = (await findMachine()).lastSeen;
    expect(Date.parse(seen2)).toBeGreaterThan(Date.parse(seen1));

    await daemon.stop();
    const offline = await findMachine();
    expect(offline.status).toBe("offline");
    expect(isMachineOnline(offline)).toBe(false);
  }, 30_000);

  it("una máquina con heartbeat obsoleto se considera offline aunque su status sea online", async () => {
    const stale: Pick<Machine, "status" | "lastSeen"> = {
      status: "online",
      lastSeen: new Date(Date.now() - 60_000).toISOString(),
    };
    expect(isMachineOnline(stale, { staleAfterMs: 30_000 })).toBe(false);
  });
});
