import type { Event } from "@opencode-ai/sdk";
import type { PermissionDecision, RequestPermission } from "../../agent-adapter.js";
import { mapOpencodeEvent } from "./event-mapper.js";
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
 * Por turno: crea/usa la sesión, manda el prompt y drena el stream global de
 * eventos hasta `session.idle`, mapeando a `OpencodeMessage`. Acumula las partes
 * de texto/razonamiento por id para emitir una sola burbuja por bloque (en vez de
 * una por cada delta). Hace el round-trip de permisos y aborta en la señal.
 *
 * ⚠️ Frontera de integración: sin unit test (como claude-code/sdk-transport).
 * Verificada contra los tipos de @opencode-ai/sdk v1.17.9; el ajuste fino de UX
 * se valida con el E2E vivo.
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

    const events = await client.event.subscribe();
    const iterator = events.stream[Symbol.asyncIterator]();

    // Acumulación de texto/razonamiento: una burbuja por bloque, no por delta.
    let pending: { kind: "text" | "thinking"; id: string; text: string } | null = null;
    const seenTools = new Set<string>();
    const flush = (): OpencodeMessage | null => {
      const out = pending && pending.text ? { kind: pending.kind, text: pending.text } : null;
      pending = null;
      return out;
    };

    for await (const text of options.input) {
      if (options.signal.aborted) break;
      await client.session.prompt({
        path: { id: sessionId },
        query: { directory: options.cwd },
        body: { ...(model ? { model } : {}), parts: [{ type: "text", text }] },
      });

      // Drena el stream hasta el `session.idle` de este turno.
      for (;;) {
        const next = await iterator.next();
        if (next.done || options.signal.aborted) break;
        const ev = next.value;
        const sid = eventSessionId(ev);
        if (sid && sid !== sessionId) continue; // evento de otra sesión

        if (ev.type === "permission.updated") {
          const f = flush();
          if (f) yield f;
          await replyPermission(client, ev, options.requestPermission);
          continue;
        }

        if (ev.type === "message.part.updated") {
          const part = ev.properties.part;
          if (part.type === "text" || part.type === "reasoning") {
            const kind = part.type === "text" ? "text" : "thinking";
            if (!pending || pending.id !== part.id || pending.kind !== kind) {
              const f = flush();
              if (f) yield f;
              pending = { kind, id: part.id, text: part.text ?? "" };
            } else {
              pending.text = part.text ?? pending.text;
            }
          } else if (part.type === "tool") {
            const f = flush();
            if (f) yield f;
            if (!seenTools.has(part.callID)) {
              seenTools.add(part.callID);
              yield { kind: "tool_use", tool: part.tool, title: part.tool };
            }
          }
          continue;
        }

        if (ev.type === "session.idle") {
          const f = flush();
          if (f) yield f;
          yield { kind: "result", outcome: "completed" };
          break; // turno terminado
        }

        if (ev.type === "session.error") {
          const f = flush();
          if (f) yield f;
          const mapped = mapOpencodeEvent(ev);
          if (mapped) yield mapped;
          break;
        }
      }
    }
  }
}

/** Convierte `provider/model` al `{ providerID, modelID }` que espera el API. */
function splitModel(model?: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const i = model.indexOf("/");
  if (i <= 0 || i >= model.length - 1) return undefined;
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

/** Saca el sessionID de un evento para filtrar solo el de nuestra sesión. */
function eventSessionId(ev: Event): string | undefined {
  if (ev.type === "message.part.updated") return ev.properties.part.sessionID;
  if (
    ev.type === "session.idle" ||
    ev.type === "session.error" ||
    ev.type === "permission.updated"
  ) {
    return ev.properties.sessionID;
  }
  return undefined;
}

/** Pide permiso a la app y responde a opencode (allow→once, deny→reject). */
async function replyPermission(
  client: OpencodeClient,
  ev: Extract<Event, { type: "permission.updated" }>,
  requestPermission: RequestPermission,
): Promise<void> {
  const perm = ev.properties;
  let decision: PermissionDecision = "deny";
  try {
    decision = await requestPermission({ tool: perm.type, title: perm.title });
  } catch {
    decision = "deny";
  }
  await client.postSessionIdPermissionsPermissionId({
    path: { id: perm.sessionID, permissionID: perm.id },
    body: { response: decision === "allow" ? "once" : "reject" },
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
