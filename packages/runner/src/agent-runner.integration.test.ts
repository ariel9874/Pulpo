import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PairingClient,
  claimPairing,
  createSupabaseBackend,
  type RunnerCredential,
} from "@batuta/backend-supabase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "./adapters/claude-code/index.js";
import type {
  ClaudeMessage,
  ClaudeRunOptions,
  ClaudeTransport,
} from "./adapters/claude-code/transport.js";
import { EchoAdapter } from "./adapters/echo.js";
import { AgentRunner } from "./agent-runner.js";

/** Transporte simulado que pide permiso y reacciona a la decisión (sin tokens). */
class PermissionMock implements ClaudeTransport {
  async *run(options: ClaudeRunOptions): AsyncIterable<ClaudeMessage> {
    const decision = await options.requestPermission({
      tool: "Edit",
      title: "Editar a.ts",
      diff: "- a\n+ b",
    });
    yield decision === "allow"
      ? { kind: "text", text: "editado" }
      : { kind: "text", text: "denegado" };
    yield { kind: "result", outcome: "completed" };
  }
}

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

  it(
    "LOOP MVP: la app aprueba un permiso y Claude (simulado) continúa",
    { timeout: 40_000 },
    async () => {
      const runnerBackend = createSupabaseBackend(credential.url, credential.anonKey, {
        accessToken: credential.token,
        userId: credential.userId,
      });
      const appBackend = createSupabaseBackend(credential.url, credential.anonKey, {
        accessToken: credential.token,
        userId: credential.userId,
      });
      const mvpRunner = new AgentRunner(runnerBackend, credential.machineId, [
        new ClaudeCodeAdapter(() => new PermissionMock()),
      ]);
      await mvpRunner.start();
      try {
        await appBackend.sendCommand({
          type: "new_task",
          machineId: credential.machineId,
          agentType: "claude-code",
          cwd: "/tmp",
          prompt: "edita",
        });

        const session = await waitFor(async () =>
          (await appBackend.listSessions()).find((s) => s.agentType === "claude-code"),
        );
        const perm = await waitFor(async () =>
          (await appBackend.listEvents(session.id)).find((e) => e.type === "permission_required"),
        );
        if (perm.type !== "permission_required") throw new Error("evento inesperado");

        // Aún bloqueado: no hay "editado" todavía.
        expect(
          (await appBackend.listEvents(session.id)).some(
            (e) => e.type === "message" && e.text === "editado",
          ),
        ).toBe(false);

        // La app aprueba → el runner resuelve → Claude continúa.
        await appBackend.sendCommand({
          type: "approve",
          sessionId: session.id,
          permissionId: perm.permissionId,
        });
        const done = await waitFor(async () =>
          (await appBackend.listEvents(session.id)).find(
            (e) => e.type === "message" && e.text === "editado",
          ),
        );
        expect(done).toBeTruthy();
      } finally {
        await mvpRunner.stop();
      }
    },
  );
});
