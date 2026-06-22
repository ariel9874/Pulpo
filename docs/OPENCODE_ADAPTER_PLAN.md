# Plan — Adaptador opencode (tier rico)

Plan paso a paso para añadir **opencode** como agente de Pulpo, en pasos pequeños y
verificables. Cada paso termina con su verificación (`pnpm build` / `pnpm test` /
`eslint`). Los checkpoints de commit van marcados con 💾.

> Estado del contrato (verificado en vivo, opencode CLI 1.17.9):
> `opencode serve` levanta una API HTTP con OpenAPI completo en `127.0.0.1`.
> Endpoints reales relevantes: `POST /session` (crear), `POST /session/{id}/message`
> (prompt), `GET /event` (SSE), `POST /session/{id}/abort` (cancelar),
> `POST /session/{id}/permissions/{permId}` (responder permiso), `GET /api/model`.
> `opencode models` lista el catálogo headless (`provider/model` por línea).

## Principio de diseño

Igual que los adaptadores existentes (echo, claude-code, antigravity): una interfaz
`OpencodeTransport` agnóstica del SDK que emite `OpencodeMessage`; el adaptador mapea a
`AgentEvent`. **Los unit tests usan un transporte falso** (sin levantar `opencode serve`).
El SDK real vive aislado en `sdk-transport.ts` (sin unit test, como
`claude-code/sdk-transport.ts`). Así el radio de daño de cualquier diferencia en el
contrato real es **un solo archivo**.

---

## Fase 0 — Reconocimiento y enum

### Paso 0.5 — Reconocimiento del contrato (de-riesgar antes de codificar)

Leer los tipos de `@opencode-ai/sdk` y extraer del OpenAPI (`GET /doc`) los esquemas de
`Event` / `Part` / `permission` / el body del prompt. Anotar el shape exacto de cada
evento a mapear. **No se asume: se lee y se fija.**
_Verif:_ documento de contrato con los shapes reales. Sin test (es lectura).

### Paso 1 — Instalar el SDK

`@opencode-ai/sdk` en `packages/runner`; confirmar que la versión casa con el CLI 1.17.9.
_Verif:_ `pnpm install` + los tipos resuelven.

### Paso 2 — `opencode` en el enum

Añadir `"opencode"` a `agentTypeSchema` (`packages/protocol/src/common.ts`).
_Test:_ parse de `agentType:"opencode"` en session/capabilities.
_Verif:_ `pnpm build` + `pnpm test`. 💾

---

## Fase 1 — Transporte + mapeo puro (sin servidor)

### Paso 3 — `opencode/transport.ts`

`OpencodeMessage` (`text`/`thinking`/`tool_use`/`result`/`error`), `OpencodeRunOptions`
(input, cwd, signal, requestPermission, model?, effort?), interfaz `OpencodeTransport`.
_Verif:_ `pnpm build`.

### Paso 4 — `opencode/index.ts` (adaptador esqueleto)

`toEvent()` + `OpencodeAdapter` con factory de transporte inyectable, `start`/`pump`,
`OpencodeSession` (sendMessage/cancel/dispose). Calca a antigravity.
_Verif:_ `pnpm build`.

### Paso 5 — Test: mapeo de actividad

Transporte simulado emite `thinking`,`text`,`tool_use`,`result` → asserts
`["thought","message","tool_call","task_done"]`.
_Verif:_ `pnpm test`.

### Paso 6 — Test: enchufe al AgentRunner (MemoryBackend)

`new_task` con transporte simulado → evento `message` persistido.
_Verif:_ `pnpm test`.

### Paso 7 — Test: `send_message` y `cancel`

Nuevo turno hace eco; `cancel` deja la sesión `cancelled`.
_Verif:_ `pnpm test`. 💾

---

## Fase 2 — capabilities()

### Paso 8 — `capabilities()` con discovery inyectable

`available` + `models` desde discovery; `supportsEffort:true`,
`supportsPermissions:true`, `supportsUsage:true`.
_Verif:_ `pnpm build`.

### Paso 9 — Test: capabilities()

Con discovery stub (`available:true`, 2 modelos) → asserts shape, incluido
`supportsPermissions:true`. Y caso `available:false`.
_Verif:_ `pnpm test`. 💾

---

## Fase 3 — Servidor + descubrimiento (aislado)

### Paso 10 — `opencode/server.ts` (lifecycle)

Manager que levanta `opencode serve --port 0 --hostname 127.0.0.1` lazy, parsea la URL de
`listening on …`, expone `baseUrl()`, `dispose()`. **Spawn inyectable** para test.
Siempre localhost; nunca `0.0.0.0`.
_Verif:_ `pnpm build`.

### Paso 11 — Test: parseo de URL + dispose

Con spawn falso (stdout simulado) → extrae la URL; `dispose` mata el proceso.
_Verif:_ `pnpm test`.

### Paso 12 — `opencode/discover.ts`

`discoverOpencode()`: `opencode --version` (available) + `opencode models` (catálogo
`provider/model`). Timeouts defensivos, nunca lanza.
_Verif:_ `pnpm build`.

### Paso 13 — Test: parser de `opencode models`

Función pura `parseModels(text)` → `AgentModel[]` (ignora ruido). Test con muestra real
(las 45 líneas `provider/model`).
_Verif:_ `pnpm test`. 💾

---

## Fase 4 — Transporte SDK real + mapeo de eventos

### Paso 14 — `mapOpencodeEvent()` (función pura, exportada)

Mapea un `Event` del SDK → `OpencodeMessage | null` (part texto/razonamiento/tool,
`session.idle`→result, error).
_Verif:_ `pnpm build`.

### Paso 15 — Test: `mapOpencodeEvent` (el lock del esquema)

Tests con payloads de muestra (de los tipos del SDK / del Paso 0.5): cada variante de
evento → el `OpencodeMessage` esperado; eventos irrelevantes → `null`.
_Verif:_ `pnpm test`. 💾

### Paso 16 — `opencode/sdk-transport.ts` (integración real)

Usa `@opencode-ai/sdk` contra `server.baseUrl()`: crea sesión, manda prompt, suscribe
`/event`, aplica `mapOpencodeEvent`, hace round-trip de permisos
(`permission.updated`→`requestPermission`→reply), `abort` en señal, pasa `model` y
`effort` (`--variant`). **Sin unit test** (frontera real, como claude).
_Verif:_ `pnpm build`.

### Paso 17 — Cablear defaults

Factory por defecto → `SdkOpencodeTransport`; discovery por defecto → `discoverOpencode`.
_Verif:_ `pnpm build` + `pnpm test` completo. 💾

---

## Fase 5 — Runner + app

### Paso 18 — Registrar en el runner

`new OpencodeAdapter()` en `packages/runner/src/cli.ts`.
_Verif:_ `pnpm build`.

### Paso 19 — App (capability-driven, ya casi listo)

Añadir `opencode` a `FALLBACK_AGENTS` en `apps/app/src/screens/NewTaskModal.tsx` (para el
rollout); la UI ya lo mostrará por capacidades publicadas.
_Verif:_ typecheck app + `eslint` + bundle Metro. 💾

---

## Fase 6 — Verificación viva (manual, necesita el stack)

### Paso 20 — E2E real con OpenCode Zen

Con Docker+Supabase y el runner arriba: lanzar un `new_task` opencode (modelo free) desde
la app, confirmar que los eventos llegan al hilo y que el catálogo de modelos aparece.
Ajustar `mapOpencodeEvent` si la captura real difiere.
_Verif final:_ `pnpm build` · todos los unit tests · `eslint` · bundle · round-trip
Supabase. 💾 commit final.

---

## Unit tests nuevos (resumen)

1. Enum acepta `opencode` (protocol).
2. Mapeo de actividad → secuencia de eventos.
3. Enchufe al AgentRunner (new_task end-to-end con MemoryBackend).
4. `send_message` + `cancel`.
5. `capabilities()` (disponible + permisos `true`; y no-disponible).
6. Server lifecycle: parseo de URL + dispose (spawn falso).
7. `parseModels` (catálogo).
8. `mapOpencodeEvent` (todas las variantes + nulos) ← el lock del esquema.

---

## Seguridad y privacidad (importante)

opencode **no sube el PC entero**: es un agente de código que solo lee/edita dentro del
`cwd` que se le da por tarea. Lo que sale de la máquina es lo mismo que con cualquier
agente de IA (Claude Code incluido): los **archivos que lee en esa carpeta + los prompts**
van al **modelo**. En este setup, vía **OpenCode Zen** (pasarela de la empresa de
opencode) — un tercero en la ruta, sustituible por una API key directa.

Decisiones de diseño seguro (ya en el plan):

- **cwd acotado por tarea** — apuntar a un proyecto, no a la carpeta personal.
- **Gating de permisos**: mapear los permisos de opencode al aprobar/rechazar de la app.
  **No** usar `--dangerously-skip-permissions`.
- **Servidor en `127.0.0.1`** — nunca `0.0.0.0`.
- **Probar primero en una carpeta vacía** hasta tener confianza.

Pendiente de verificar antes de confiar en producción: **telemetría** por defecto de
opencode (hay `--pure`) y qué **retiene OpenCode Zen**.

---

## Evaluación de riesgo (honesta)

| Parte                                    | Confianza                          | Por qué                                                                                              |
| ---------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Fases 0–3 + tests con transporte falso   | ~90-95%                            | Patrón ya repetido 3 veces; `opencode models` y `serve` ya verificados en vivo                       |
| Pasos 14–16, 20 (SDK real + mapeo + E2E) | ~60-70% → ~85-90% tras el Paso 0.5 | Aún no observé el stream de eventos real; está **documentado** (OpenAPI + SDK) pero no leído/probado |

El riesgo está **contenido**: el transporte real está aislado en `sdk-transport.ts`, y
`mapOpencodeEvent` es función pura con tests. Si el shape real difiere, cambia **un
archivo y unos tests** — no hay rediseño.
