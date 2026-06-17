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
}

export type PairingPollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "claimed"; token: string; machine_id: string; user_id: string };

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cliente del flujo device-code (lado runner). Usa la clave anon: el runner aún
 * no tiene credencial propia. `start` crea el código; `waitForClaim` espera a que
 * el usuario lo reclame en la app y devuelve la credencial del runner.
 */
export class PairingClient {
  private readonly client: SupabaseClient;

  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async start(): Promise<PairingStart> {
    const { data, error } = await this.client.rpc("pairing_start");
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
): Promise<{ machineId: string }> {
  const { data, error } = await authedClient.rpc("pairing_claim", { p_code: deviceCode });
  if (error) throw error;
  return { machineId: (data as { machine_id: string }).machine_id };
}
