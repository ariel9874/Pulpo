import { generateBoxKeyPair } from "@pulpo/protocol";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface PairingStart {
  deviceCode: string;
  deviceSecret: string;
}

export interface RunnerCredential {
  url: string;
  /** Clave anon (pública) para el gateway; el token va como Authorization Bearer. */
  anonKey: string;
  token: string;
  machineId: string;
  userId: string;
  /** Clave pública (base64) que firma los comandos; el runner la usa para verificar. */
  signerPublicKey?: string;
  /** Clave pública de cifrado (base64) de la app; el runner cifra los diffs hacia ella. */
  boxPublicKey?: string;
  /** Clave PRIVADA de cifrado del runner (base64); con ella firma/cifra los diffs (e2e mutuo). */
  senderBoxSecretKey?: string;
}

export type PairingPollResult =
  | { status: "pending" }
  | { status: "expired" }
  | {
      status: "claimed";
      token: string;
      machine_id: string;
      user_id: string;
      signer_public_key?: string | null;
      box_public_key?: string | null;
    };

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cliente del flujo device-code (lado runner). Usa la clave anon: el runner aún
 * no tiene credencial propia. `start` crea el código; `waitForClaim` espera a que
 * el usuario lo reclame en la app y devuelve la credencial del runner.
 */
export class PairingClient {
  private readonly client: SupabaseClient;
  /** Par de cifrado del runner, generado en `start` y entregado en la credencial. */
  private boxKeyPair: { publicKey: string; secretKey: string } | undefined;

  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async start(): Promise<PairingStart> {
    this.boxKeyPair = generateBoxKeyPair();
    const { data, error } = await this.client.rpc("pairing_start", {
      p_runner_box_public: this.boxKeyPair.publicKey,
    });
    if (error) throw error;
    const d = data as { device_code: string; device_secret: string };
    return { deviceCode: d.device_code, deviceSecret: d.device_secret };
  }

  async poll(deviceCode: string, deviceSecret: string): Promise<PairingPollResult> {
    const { data, error } = await this.client.rpc("pairing_poll", {
      p_code: deviceCode,
      p_secret: deviceSecret,
    });
    if (error) throw error;
    return data as PairingPollResult;
  }

  /** Sondea hasta que el código sea reclamado (o expire / se agote el tiempo). */
  async waitForClaim(
    start: PairingStart,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<RunnerCredential> {
    const intervalMs = opts.intervalMs ?? 2_000;
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await this.poll(start.deviceCode, start.deviceSecret);
      if (res.status === "claimed") {
        return {
          url: this.url,
          anonKey: this.anonKey,
          token: res.token,
          machineId: res.machine_id,
          userId: res.user_id,
          ...(res.signer_public_key ? { signerPublicKey: res.signer_public_key } : {}),
          ...(res.box_public_key ? { boxPublicKey: res.box_public_key } : {}),
          ...(this.boxKeyPair ? { senderBoxSecretKey: this.boxKeyPair.secretKey } : {}),
        };
      }
      if (res.status === "expired") throw new Error("El código de emparejamiento expiró");
      if (Date.now() > deadline) throw new Error("Tiempo de espera agotado para el emparejamiento");
      await delay(intervalMs);
    }
  }
}

/**
 * Reclama un código de emparejamiento (lado app). `authedClient` debe estar
 * autenticado como el usuario; crea su machine y mintea el token del runner.
 */
export async function claimPairing(
  authedClient: SupabaseClient,
  deviceCode: string,
  signerPublicKey?: string,
  boxPublicKey?: string,
): Promise<{ machineId: string; runnerBoxPublicKey?: string }> {
  const { data, error } = await authedClient.rpc("pairing_claim", {
    p_code: deviceCode,
    ...(signerPublicKey ? { p_public_key: signerPublicKey } : {}),
    ...(boxPublicKey ? { p_box_public: boxPublicKey } : {}),
  });
  if (error) throw error;
  const row = data as { machine_id: string; runner_box_public_key?: string | null };
  return {
    machineId: row.machine_id,
    ...(row.runner_box_public_key ? { runnerBoxPublicKey: row.runner_box_public_key } : {}),
  };
}
