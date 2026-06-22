import type { Event } from "@opencode-ai/sdk";
import type { PermissionDecision, RequestPermission } from "../../agent-adapter.js";
import { mapPart } from "./event-mapper.js";
import { opencodeClient } from "./server.js";
import type { OpencodeMessage, OpencodeRunOptions, OpencodeTransport } from "./transport.js";

export interface SdkTransportOptions {
  /** Modelo elegido en formato `provider/model` (p. ej. `opencode/claude-opus-4-8`). */
  model?: string;
}

type OpencodeClient = Awaited<ReturnType<typeof opencodeClient>>;

/**
 * Transporte real sobre el servidor de opencode (vía `@opencode-ai/sdk`).
 *
 * Verificado en vivo (v1.17.9): `session.prompt` es **síncrono** y devuelve la
 * respuesta del turno en `result.data.parts` (el stream `/event` solo trae
 * heartbeats para quien promptea). Así que la respuesta se mapea desde
 * `data.parts`; el stream se usa **solo** para el gating de permisos, que corre
 * en paralelo porque un tool con permiso bloquearía el prompt hasta responderlo.
 *
 * ⚠️ Frontera de integración: sin unit test (como claude-code/sdk-transport).
 */
export class SdkOpencodeTransport implements OpencodeTransport {
  constructor(private readonly opts: SdkTransportOptions = {}) {}

  async *run(options: OpencodeRunOptions): AsyncIterable<OpencodeMessage> {
    let client: OpencodeClient;
    try {
      client = await opencodeClient();
    } catch (err) {
      yield { kind: "error", message: `No se pudo iniciar opencode: ${errMsg(err)}` };
      return;
    }

    const model = splitModel(this.opts.model);
    const created = await client.session.create({ body: {}, query: { directory: options.cwd } });
    const sessionId = created.data?.id;
    if (!sessionId) {
      yield { kind: "error", message: "opencode no devolvió una sesión" };
      return;
    }

    options.signal.addEventListener(
      "abort",
      () => void client.session.abort({ path: { id: sessionId } }),
      { once: true },
    );

    // Watcher de permisos: corre en paralelo porque `prompt` se bloquea si un tool
    // pide permiso, y nadie respondería desde dentro del await del prompt.
    const watcher = new PermissionWatcher(client, sessionId, options.requestPermission);
    void watcher.start();

    try {
      for await (const text of options.input) {
        if (options.signal.aborted) break;
        let result;
        try {
          result = await client.session.prompt({
            path: { id: sessionId },
            query: { directory: options.cwd },
            body: { ...(model ? { model } : {}), parts: [{ type: "text", text }] },
          });
        } catch (err) {
          yield { kind: "error", message: errMsg(err) };
          continue;
        }
        if (options.signal.aborted) break;
        if (result.error) {
          yield { kind: "error", message: errMsg(result.error) };
          continue;
        }
        for (const part of result.data?.parts ?? []) {
          const message = mapPart(part);
          if (message) yield message;
        }
        yield { kind: "result", outcome: "completed" };
      }
    } finally {
      await watcher.stop();
    }
  }
}

/**
 * Suscribe al stream de eventos y responde los `permission.updated` de la sesión
 * con la decisión de la app (allow→once, deny→reject), hasta que se detiene.
 */
class PermissionWatcher {
  private stream: AsyncGenerator<Event> | undefined;
  private stopped = false;

  constructor(
    private readonly client: OpencodeClient,
    private readonly sessionId: string,
    private readonly requestPermission: RequestPermission,
  ) {}

  async start(): Promise<void> {
    try {
      const events = await this.client.event.subscribe();
      this.stream = events.stream as AsyncGenerator<Event>;
      for await (const ev of this.stream) {
        if (this.stopped) break;
        if (ev.type === "permission.updated" && ev.properties.sessionID === this.sessionId) {
          await this.reply(ev);
        }
      }
    } catch {
      // El stream se cerró o falló; no es fatal para la tarea.
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    try {
      await this.stream?.return(undefined);
    } catch {
      // ignore
    }
  }

  private async reply(ev: Extract<Event, { type: "permission.updated" }>): Promise<void> {
    const perm = ev.properties;
    let decision: PermissionDecision = "deny";
    try {
      decision = await this.requestPermission({ tool: perm.type, title: perm.title });
    } catch {
      decision = "deny";
    }
    await this.client.postSessionIdPermissionsPermissionId({
      path: { id: perm.sessionID, permissionID: perm.id },
      body: { response: decision === "allow" ? "once" : "reject" },
    });
  }
}

/** Convierte `provider/model` al `{ providerID, modelID }` que espera el API. */
function splitModel(model?: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const i = model.indexOf("/");
  if (i <= 0 || i >= model.length - 1) return undefined;
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const data = (err as { data?: { message?: unknown } }).data;
    if (data && typeof data.message === "string") return data.message;
    return JSON.stringify(err).slice(0, 300);
  }
  return String(err);
}
