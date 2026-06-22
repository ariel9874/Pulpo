import type { BackendPort } from "@pulpo/protocol";

export interface RunnerDaemonOptions {
  /** Cada cuánto manda heartbeat (ms). Por defecto 15 s. */
  heartbeatIntervalMs?: number;
  onError?: (err: unknown) => void;
}

/**
 * El demonio del runner: late periódicamente para mantener su máquina `online`
 * y, en un apagado limpio, la marca `offline`. Si el proceso muere de golpe, la
 * máquina queda obsoleta y los lectores la ven offline (ver `isMachineOnline`).
 */
export class RunnerDaemon {
  private timer: NodeJS.Timeout | undefined;
  private readonly intervalMs: number;
  private readonly onError: (err: unknown) => void;

  constructor(
    private readonly backend: BackendPort,
    private readonly machineId: string,
    options: RunnerDaemonOptions = {},
  ) {
    this.intervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.onError = options.onError ?? ((err) => console.error("heartbeat:", err));
  }

  /** Marca la máquina online y arranca el heartbeat periódico. */
  async start(): Promise<void> {
    await this.backend.heartbeat(this.machineId);
    this.timer = setInterval(() => void this.beat(), this.intervalMs);
    this.timer.unref?.();
  }

  private async beat(): Promise<void> {
    try {
      await this.backend.heartbeat(this.machineId);
    } catch (err) {
      this.onError(err);
    }
  }

  /** Detiene el heartbeat y marca la máquina offline (apagado limpio). */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    try {
      await this.backend.setMachineStatus(this.machineId, "offline");
    } catch (err) {
      this.onError(err);
    }
  }
}
