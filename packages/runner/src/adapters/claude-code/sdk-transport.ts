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
interface SdkMessage {
  type: string;
  subtype?: string;
  message?: { content?: SdkContentBlock[] };
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
 *   Code / suscripción). Batuta no las almacena.
 * - ⚠️ Capa marcada como interfaz no garantizada: verificada contra la doc del
 *   Agent SDK al implementar; se reaislaría aquí si el SDK cambia.
 */
export class SdkClaudeTransport implements ClaudeTransport {
  constructor(private readonly model?: string) {}

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
          ...(this.model ? { model: this.model } : {}),
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
          yield { kind: "result", outcome: message.subtype === "success" ? "completed" : "failed" };
        }
      }
    } finally {
      options.signal.removeEventListener("abort", onAbort);
    }
  }
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
