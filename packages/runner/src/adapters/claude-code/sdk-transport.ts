import type { ClaudeMessage, ClaudeRunOptions, ClaudeTransport } from "./transport.js";

// Tipos mínimos de lo que consumimos del Claude Agent SDK (verificado contra su
// doc TS: query() emite SDKMessage; assistant.message.content lleva bloques
// text/thinking/tool_use; result lleva subtype). No tipamos todo el SDK.
interface SdkContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
}
interface SdkModelUsage {
  inputTokens?: number;
  outputTokens?: number;
}
interface SdkMessage {
  type: string;
  subtype?: string;
  message?: { content?: SdkContentBlock[] };
  // Campos del mensaje `result` (uso/coste de la tarea).
  total_cost_usd?: number;
  num_turns?: number;
  modelUsage?: Record<string, SdkModelUsage>;
}
interface ClaudeAgentSdk {
  query(args: {
    prompt: string | AsyncIterable<unknown>;
    options?: Record<string, unknown>;
  }): AsyncIterable<SdkMessage>;
}

/** Mapea la entrada del usuario al formato de mensajes del SDK (modo streaming). */
async function* toSdkUserMessages(input: AsyncIterable<string>): AsyncIterable<unknown> {
  for await (const text of input) {
    yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
  }
}

/**
 * Transporte real sobre el Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 *
 * - **Import perezoso y opcional:** el SDK solo hace falta para ejecutar Claude de
 *   verdad. Se importa con un especificador no literal para no acoplar la
 *   compilación al paquete; si no está instalado, emite un error claro.
 * - **Credenciales:** usa las del host (ANTHROPIC_API_KEY o el login de Claude
 *   Code / suscripción). Pulpo no las almacena.
 * - ⚠️ Capa marcada como interfaz no garantizada: verificada contra la doc del
 *   Agent SDK al implementar; se reaislaría aquí si el SDK cambia.
 */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface SdkTransportOptions {
  /** Alias ('opus', 'sonnet', 'haiku', 'fable') o ID completo ('claude-opus-4-8'). */
  model?: string;
  /** Profundidad de razonamiento (effort del Agent SDK). */
  effort?: EffortLevel;
}

/** Defaults explícitos: así sabemos qué modelo corre, en vez de heredar el del host. */
const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_EFFORT: EffortLevel = "high";

export class SdkClaudeTransport implements ClaudeTransport {
  private readonly model: string;
  private readonly effort: EffortLevel;
  constructor(opts: SdkTransportOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.effort = opts.effort ?? DEFAULT_EFFORT;
  }

  async *run(options: ClaudeRunOptions): AsyncIterable<ClaudeMessage> {
    // Especificador como `string` (no literal) → import dinámico sin resolución
    // estática: compila aunque el paquete no esté instalado.
    const specifier: string = "@anthropic-ai/claude-agent-sdk";
    let sdk: ClaudeAgentSdk;
    try {
      sdk = (await import(specifier)) as ClaudeAgentSdk;
    } catch {
      yield {
        kind: "error",
        message: `Falta "${specifier}". Instálalo en el runner para usar el agente claude-code.`,
      };
      return;
    }

    const abort = new AbortController();
    const onAbort = (): void => abort.abort();
    options.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const stream = sdk.query({
        prompt: toSdkUserMessages(options.input),
        options: {
          cwd: options.cwd,
          abortController: abort,
          permissionMode: "default",
          // El hook de permisos del SDK: bloquea hasta que el usuario decide.
          canUseTool: async (toolName: string, input: Record<string, unknown>) => {
            const decision = await options.requestPermission({
              tool: toolName,
              title: summarizeTool(toolName, input),
              diff: buildDiff(toolName, input),
            });
            return decision === "allow"
              ? { behavior: "allow", updatedInput: input }
              : { behavior: "deny", message: "Rechazado desde la app." };
          },
          model: this.model,
          effort: this.effort,
        },
      });
      for await (const message of stream) {
        if (message.type === "assistant") {
          for (const block of message.message?.content ?? []) {
            if (block.type === "text" && block.text) {
              yield { kind: "text", text: block.text };
            } else if (block.type === "thinking" && block.thinking) {
              yield { kind: "thinking", text: block.thinking };
            } else if (block.type === "tool_use" && block.name) {
              yield {
                kind: "tool_use",
                tool: block.name,
                title: summarizeTool(block.name, block.input ?? {}),
              };
            }
          }
        } else if (message.type === "result") {
          // El uso de la tarea + (si hay suscripción) la cuota restante del plan.
          // La cuota se pide aquí, con la sesión aún viva, no tras cerrar el stream.
          const summary = [formatUsage(message), await fetchPlanUsage(stream)]
            .filter(Boolean)
            .join(" · ");
          yield {
            kind: "result",
            outcome: message.subtype === "success" ? "completed" : "failed",
            ...(summary ? { summary } : {}),
          };
        }
      }
    } finally {
      options.signal.removeEventListener("abort", onAbort);
    }
  }
}

/** Ventana de límite de uso del plan (porción que se ha consumido). */
interface SdkRateWindow {
  utilization?: number | null;
}
/** Respuesta (parcial) de la API experimental de uso del Agent SDK. */
interface SdkUsageResponse {
  rate_limits_available?: boolean;
  rate_limits?: {
    five_hour?: SdkRateWindow | null;
    seven_day?: SdkRateWindow | null;
    seven_day_opus?: SdkRateWindow | null;
  } | null;
}

/**
 * Cuota restante del plan claude.ai (experimental; solo en sesiones con
 * suscripción). Feature-detect + try/catch + timeout: nunca rompe ni demora la
 * tarea. Devuelve algo como `plan libre · 5h 58% · 7d 82%`.
 */
async function fetchPlanUsage(stream: unknown): Promise<string | undefined> {
  const fn = (stream as Record<string, unknown>)
    .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
  if (typeof fn !== "function") return undefined;
  try {
    const call = (fn as () => Promise<SdkUsageResponse>).call(stream);
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000));
    const usage = await Promise.race([call, timeout]);
    return usage ? formatPlan(usage) : undefined;
  } catch {
    return undefined; // API experimental: si cambia o falla, lo ignoramos.
  }
}

function formatPlan(u: SdkUsageResponse): string | undefined {
  if (!u.rate_limits_available || !u.rate_limits) return undefined;
  const w = u.rate_limits;
  const free = (win: SdkRateWindow | null | undefined): number | undefined =>
    typeof win?.utilization === "number" ? Math.max(0, Math.round(100 - win.utilization)) : undefined;
  const parts: string[] = [];
  const h5 = free(w.five_hour);
  const d7 = free(w.seven_day);
  const d7opus = free(w.seven_day_opus);
  if (h5 !== undefined) parts.push(`5h ${h5}%`);
  if (d7 !== undefined) parts.push(`7d ${d7}%`);
  if (d7opus !== undefined) parts.push(`7d-opus ${d7opus}%`);
  return parts.length > 0 ? `plan libre · ${parts.join(" · ")}` : undefined;
}

/** Resumen legible del uso de la tarea: modelo real, tokens, coste y turnos. */
function formatUsage(m: SdkMessage): string | undefined {
  const parts: string[] = [];
  const [first] = Object.entries(m.modelUsage ?? {});
  if (first) {
    const [modelId, u] = first;
    parts.push(modelId);
    parts.push(`${formatTokens(u.inputTokens ?? 0)} ent · ${formatTokens(u.outputTokens ?? 0)} sal`);
  }
  if (typeof m.total_cost_usd === "number") parts.push(`$${m.total_cost_usd.toFixed(4)}`);
  if (typeof m.num_turns === "number") parts.push(`${m.num_turns} turno${m.num_turns === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Diff/resumen textual de lo que haría una herramienta sensible (para el permiso). */
function buildDiff(name: string, input: Record<string, unknown>): string | undefined {
  const file = typeof input.file_path === "string" ? input.file_path : undefined;
  if (typeof input.old_string === "string" && typeof input.new_string === "string") {
    return `${file ?? ""}\n- ${input.old_string}\n+ ${input.new_string}`.trim();
  }
  if (file && typeof input.content === "string") {
    return `${name} ${file}\n${input.content}`;
  }
  if (typeof input.command === "string") return `$ ${input.command}`;
  return undefined;
}

/** Título corto para un tool_call: nombre + el campo más representativo del input. */
function summarizeTool(name: string, input: Record<string, unknown>): string {
  const key = ["file_path", "path", "command", "pattern", "url"].find(
    (k) => typeof input[k] === "string",
  );
  const detail = key ? String(input[key]) : "";
  return detail ? `${name}: ${detail.slice(0, 80)}` : name;
}
