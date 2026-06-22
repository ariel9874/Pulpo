import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PairingClient, claimPairing } from "@pulpo/backend-supabase";
import { generateBoxKeyPair, generateSigningKeyPair } from "@pulpo/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCredential, saveCredential } from "./credentials.js";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const hasEnv = Boolean(URL && SERVICE_KEY && ANON_KEY);

const PASSWORD = "password-123";

describe.skipIf(!hasEnv)("Pairing device-code (integración — requiere Supabase local)", () => {
  let admin: SupabaseClient;
  let userId: string;
  let appClient: SupabaseClient; // app autenticada como el usuario

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `pair-${Date.now()}-${Math.random().toString(36).slice(2)}@pulpo.dev`;
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
  }, 30_000);

  afterAll(async () => {
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
  });

  it("empareja: start → claim (app) → poll devuelve un token de runner usable", async () => {
    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    expect(start.deviceCode).toMatch(/^[0-9A-F]{8}$/);

    // El runner espera; la app reclama el código en paralelo.
    const credentialPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    const { machineId } = await claimPairing(appClient, start.deviceCode);
    const credential = await credentialPromise;

    expect(credential.userId).toBe(userId);
    expect(credential.machineId).toBe(machineId);
    expect(credential.url).toBe(URL);
    expect(credential.token.split(".")).toHaveLength(3); // JWT
    expect(credential.token).not.toBe(SERVICE_KEY);
    expect(credential.token).not.toBe(ANON_KEY);

    // El token autoriza como el usuario: el runner puede ver SU máquina (RLS).
    const runnerClient = createClient(URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${credential.token}` } },
    });
    const { data: machines, error } = await runnerClient
      .from("machines")
      .select("id, user_id")
      .eq("id", machineId);
    expect(error).toBeNull();
    expect(machines).toHaveLength(1);
    expect(machines![0]).toMatchObject({ id: machineId, user_id: userId });
  }, 30_000);

  it("registra la clave pública de firma y la devuelve en la credencial", async () => {
    const { publicKey } = generateSigningKeyPair();
    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    const credentialPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    await claimPairing(appClient, start.deviceCode, publicKey);
    const credential = await credentialPromise;
    expect(credential.signerPublicKey).toBe(publicKey);
  }, 30_000);

  it("sin clave pública, la credencial no la trae (compatibilidad)", async () => {
    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    const credentialPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    await claimPairing(appClient, start.deviceCode);
    const credential = await credentialPromise;
    expect(credential.signerPublicKey).toBeUndefined();
    expect(credential.boxPublicKey).toBeUndefined();
  }, 30_000);

  it("registra la clave de cifrado y la devuelve en la credencial", async () => {
    const signer = generateSigningKeyPair();
    const box = generateBoxKeyPair();
    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    const credentialPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    await claimPairing(appClient, start.deviceCode, signer.publicKey, box.publicKey);
    const credential = await credentialPromise;
    expect(credential.signerPublicKey).toBe(signer.publicKey);
    expect(credential.boxPublicKey).toBe(box.publicKey);
  }, 30_000);

  it("intercambia las claves de cifrado en ambos sentidos (e2e mutuo)", async () => {
    const box = generateBoxKeyPair();
    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    const credentialPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    const claim = await claimPairing(appClient, start.deviceCode, undefined, box.publicKey);
    const credential = await credentialPromise;
    // La app recibe la pública del runner (para autenticar diffs)…
    expect(claim.runnerBoxPublicKey).toBeTruthy();
    // …y el runner recibe la pública de la app + conserva su propia privada.
    expect(credential.boxPublicKey).toBe(box.publicKey);
    expect(credential.senderBoxSecretKey).toBeTruthy();
  }, 30_000);

  it("guarda y recarga la credencial en disco", async () => {
    const pairing = new PairingClient(URL!, ANON_KEY!);
    const start = await pairing.start();
    const credentialPromise = pairing.waitForClaim(start, { intervalMs: 200, timeoutMs: 15_000 });
    await claimPairing(appClient, start.deviceCode);
    const credential = await credentialPromise;

    const path = join(
      tmpdir(),
      `pulpo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "credentials.json",
    );
    try {
      expect(await loadCredential(path)).toBeNull();
      await saveCredential(credential, path);
      expect(await loadCredential(path)).toEqual(credential);
    } finally {
      await rm(join(path, ".."), { recursive: true, force: true });
    }
  }, 30_000);
});
