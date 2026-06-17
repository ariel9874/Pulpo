import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PairingClient,
  claimPairing,
  createSupabaseBackend,
  type RunnerCredential,
} from "@batuta/backend-supabase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EchoAdapter } from "./adapters/echo.js";
import { AgentRunner } from "./agent-runner.js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const hasEnv = Boolean(URL && SERVICE_KEY && ANON_KEY);

const PASSWORD = "password-123";

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!hasEnv)("AgentRunner echo (integración — commands/events por Realtime)", () => {
  let admin: SupabaseClient;
  let userId: string;
  let credential: RunnerCredential;
  let runner: AgentRunner;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `agent-${Date.now()}-${Math.random().toString(36).slice(2)}@batuta.dev`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    const appAuth = createClient(URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signErr } = await appAuth.auth.signInWithPassword({ email, password: PASSWORD });
    if (signErr) throw signErr;

    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    const credPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    await claimPairing(appAuth, start.deviceCode);
    credential = await credPromise;
  }, 30_000);

  afterAll(async () => {
    if (runner) await runner.stop();
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it("la app manda new_task/send_message y recibe el eco por events", async () => {
    const runnerBackend = createSupabaseBackend(credential.url, credential.anonKey, {
      accessToken: credential.token,
      userId: credential.userId,
    });
    const appBackend = createSupabaseBackend(credential.url, credential.anonKey, {
      accessToken: credential.token,
      userId: credential.userId,
    });

    runner = new AgentRunner(runnerBackend, credential.machineId, [new EchoAdapter()]);
    await runner.start(); // resuelve cuando la suscripción a commands está lista

    await appBackend.sendCommand({
      type: "new_task",
      machineId: credential.machineId,
      agentType: "echo",
      cwd: "/tmp",
      prompt: "hola",
    });

    // El runner crea la sesión y emite el primer eco.
    const session = await waitFor(async () => (await appBackend.listSessions())[0]);
    const firstEcho = await waitFor(async () =>
      (await appBackend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: hola",
      ),
    );
    expect(firstEcho).toBeTruthy();

    await appBackend.sendCommand({ type: "send_message", sessionId: session.id, text: "mundo" });
    const secondEcho = await waitFor(async () =>
      (await appBackend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: mundo",
      ),
    );
    expect(secondEcho).toBeTruthy();
  }, 40_000);
});
