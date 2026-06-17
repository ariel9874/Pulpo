# Batuta — Plan por etapas

> **Batuta** (nombre provisional, cámbialo cuando quieras): una app open source para
> orquestar tus agentes de IA (Claude Code, Antigravity, Codex…) desde el móvil y la web,
> mientras tu PC se queda encendida ejecutándolos. El móvil es el **control remoto**, no el IDE.

---

## Decisiones ya tomadas

| Tema | Decisión | Consecuencia para el plan |
|---|---|---|
| Backend | **Supabase** (Postgres + Realtime + Edge Functions + Auth) | No construimos servidor propio. La sincronización va por Realtime sobre Postgres. |
| Primer agente | **Claude Code** | El "vertical slice" (fase 2-3) se hace con Claude. Antigravity entra después (etapa 22). |
| Stack | **Todo TypeScript** | App en Expo, runner en Node, protocolo TS compartido de punta a punta. |
| Portabilidad | **Capa fina de abstracción** (`BackendPort`) | Tu código nunca llama a Supabase directo; llama a una interfaz. Mañana puedes self-hostear. |

**Principio rector** (alineado con tu preferencia de *fragmentos portables y testeados, sin
sobre-ingeniería*): cada etapa entrega **un fragmento aislado y verificable**. Nada de "construyo
medio sistema y al final pruebo". Cada pasito tiene un criterio de éxito que puedes comprobar solo.

---

## Reglas globales del proyecto

Estas reglas aplican a **todas** las etapas y a todos los componentes (runner, adaptadores, app):

### Regla 1 · Auto-instalar lo que falte
Si una herramienta o dependencia necesaria **no está instalada**, el sistema la **descarga e instala
automáticamente** en vez de fallar y pedírtelo. Aplica a:
- **Runtimes y CLIs de agentes** (p. ej. el CLI de Claude Code, el de Antigravity, Codex, Node, etc.):
  el runner detecta su ausencia y los instala antes de arrancar una sesión.
- **Dependencias de tareas** que un agente necesite para ejecutar lo que le pediste.

> **Guardarraíl de seguridad (obligatorio).** Auto-instalar = ejecutar software en tu PC, así que NO
> es "instala lo que sea". Reglas de la auto-instalación:
> 1. Solo desde **fuentes confiables** (gestores oficiales: el instalador oficial del vendor, npm,
>    winget/brew/apt, etc.), nunca scripts arbitrarios de internet.
> 2. Contra una **lista blanca** de herramientas conocidas; lo que esté fuera de la lista **pide
>    confirmación** antes de instalar.
> 3. Cada auto-instalación queda **registrada como evento** (`tool_install`) visible en la app, para
>    que sepas qué se instaló y cuándo.
> 4. Verificar la instalación (versión/checksum) antes de continuar.

*(Se implementa sobre todo en la Etapa 8 —arranque del runner—, la Etapa 10 —adaptador— y se endurece
en la Etapa 21 —seguridad—.)*

### Regla 2 · Ante la duda, investigar en internet
Si el sistema (o tú al desarrollar) **no está seguro** de algo —la firma exacta de una API, un hook,
un formato de protocolo, un mensaje de error desconocido, cómo se instala una herramienta— **debe
investigar en internet primero** y no asumir ni inventar.
- Aplica especialmente a las interfaces marcadas con ⚠️ en este plan (API/hooks de Claude Code en la
  Etapa 10-11, RPC de Antigravity en la Etapa 22): se **verifican contra su documentación vigente**
  antes de implementarlas.
- Preferir **fuentes oficiales** (docs del vendor) sobre blogs; si hay conflicto, gana la doc oficial.
- Lo investigado se **deja anotado** (en el código o en el doc de la etapa) con la fuente, para no
  repetir la búsqueda.

---

## Visión de la arquitectura

```
   ┌─────────────────┐        ┌──────────────────────┐        ┌──────────────────────────┐
   │   App (Expo)    │        │      Supabase        │        │   Runner (tu PC siempre  │
   │ iOS/Android/web │◄──────►│  Postgres + Realtime │◄──────►│   prendida, Node)        │
   │                 │  RLS   │  Auth + Edge Funcs   │  RLS   │                          │
   │ - lista sesiones│        │                      │        │  ┌────────────────────┐  │
   │ - stream activid│        │  Tablas:             │        │  │ Adaptador Claude   │──┼─► claude code
   │ - diff aprob/rec│        │   sessions/events/   │        │  ├────────────────────┤  │
   │ - mandar tareas │        │   commands/perms     │        │  │ Adaptador Antigrav.│──┼─► antigravity
   │ - push          │        │                      │        │  ├────────────────────┤  │
   └─────────────────┘        │  Edge Function ──► FCM│        │  │ Adaptador Codex…   │──┼─► …
                              └──────────────────────┘        │  └────────────────────┘  │
                                                              └──────────────────────────┘

   Flujo: el runner ESCRIBE eventos y LEE comandos. La app LEE eventos y ESCRIBE comandos.
          Realtime hace de "cable" en ambos sentidos. RLS garantiza que cada quien ve solo lo suyo.
```

### Las piezas (monorepo TypeScript con pnpm workspaces)

```
batuta/
├─ packages/
│  ├─ protocol/          → tipos del modelo (Event, Command, Session…) + validadores (zod)
│  │                       y la interfaz BackendPort (la capa de abstracción)
│  ├─ backend-supabase/  → implementación de BackendPort sobre supabase-js
│  ├─ backend-memory/    → implementación falsa en memoria, para tests sin red
│  └─ runner/            → demonio local + contrato AgentAdapter
│     └─ adapters/
│        ├─ echo/        → adaptador de prueba (no usa IA real)
│        └─ claude-code/ → primer adaptador real
├─ apps/
│  └─ app/               → Expo (React Native + RN Web)
└─ supabase/             → migraciones SQL, políticas RLS, Edge Functions
```

### El modelo de datos (tablas en Supabase)

| Tabla | Para qué | Quién escribe | Quién lee |
|---|---|---|---|
| `machines` | PCs registradas (1 por runner), heartbeat, estado online | runner | app |
| `sessions` | una sesión de agente: tipo de agente, título, estado y **directorio de trabajo** (`cwd`/proyecto) | runner | app |
| `events` | append-only: actividad del agente (mensaje, tool_call, plan, error…) | runner | app |
| `commands` | órdenes de la app: nueva_tarea, mensaje, cancelar, aprobar, rechazar | app | runner |
| `permissions` | petición de permiso con su diff + decisión | runner crea / app decide | ambos |
| `device_tokens` | tokens de push (FCM) por dispositivo | app | Edge Function |

> **Por qué dos tablas (events/commands) y no una:** separar el sentido del flujo simplifica las
> suscripciones Realtime y las políticas RLS, y hace trivial la idempotencia (un command se marca
> `consumed` cuando el runner lo procesa).

> **Payloads grandes (diffs y salidas de tools).** Realtime y las filas de Postgres tienen un límite
> de tamaño práctico. Los diffs y outputs grandes **no** viajan en el evento: se suben a **Supabase
> Storage** y el evento lleva solo una **referencia** (URL/clave + hash + tamaño). Así el stream sigue
> ligero y los diffs gordos no rompen la suscripción. *(Se decide en la Etapa 2 y se usa desde la 15-16.)*

---

## Cómo trabajar cada etapa (el "pasito seguro")

Repite este ciclo en TODAS las etapas:

1. **Rama** nueva por etapa (`etapa-05-backend-supabase`).
2. **Implementa** solo lo de esa etapa.
3. **Test** del fragmento (unitario o de integración) — debe correr aislado.
4. **Demo** manual del criterio de éxito (la "prueba de que funciona" listada en la etapa).
5. **Commit** y merge. Si algo no cumple el criterio, no avanzas a la siguiente.

---

# FASE 0 — Fundaciones

### Etapa 1 · Monorepo y herramientas
**Objetivo:** tener el esqueleto vacío que compila y testea.
**Pasos:**
- Inicializar repo git, `pnpm` con workspaces, TypeScript estricto, ESLint + Prettier.
- Configurar un runner de tests (Vitest) y un comando raíz `pnpm test` / `pnpm build`.
- Crear los paquetes vacíos (`protocol`, `runner`, `app`…) con su `package.json`.
**Criterio de éxito:** `pnpm build` y `pnpm test` corren sin error (aunque no haya nada que probar todavía).

### Etapa 2 · Definir el protocolo
**Objetivo:** el contrato que todos hablan. Es tu foso; hazlo con calma.
**Pasos:**
- En `packages/protocol`, definir los tipos: `Session` (incluye `cwd`/proyecto y tipo de agente),
  `Event` (con sus variantes: `message`, `thought`, `tool_call`, `plan_step`, `permission_required`,
  `task_done`, `error`, `question`, `artifact`) y `Command` (`new_task`, `send_message`, `approve`,
  `reject`, `cancel`).
- Definir la variante **`artifact`** (recurso generado por la IA): `{ kind: 'text'|'image'|'audio'|
  'video'|'file', mime, name, size, ref }`, donde `ref` apunta a Supabase Storage (misma convención de
  payloads grandes). Es el cimiento para visualizar y descargar todo lo que produce el agente.
- Añadir un campo **`protocolVersion`** (entero o semver) en cada evento/comando, y una constante
  `PROTOCOL_VERSION` en el paquete. Runner y app se actualizan por separado: la versión te deja
  detectar incompatibilidades y degradar con gracia en vez de romper en silencio.
- Definir la convención de **payloads grandes**: los campos de diff/output llevan o bien el contenido
  inline (si es chico) o bien una **referencia** (`{ ref, hash, size }`) a Supabase Storage.
- Añadir validadores con **zod** para cada uno (validar en los bordes evita basura en la BD).
**Criterio de éxito:** tests que validan ejemplos correctos e incorrectos de cada evento/comando,
incluyendo el rechazo de una `protocolVersion` desconocida.

### Etapa 3 · La capa de abstracción `BackendPort`
**Objetivo:** que tu código nunca dependa de Supabase directamente.
**Pasos:**
- Definir la interfaz `BackendPort` con métodos como: `registerMachine`, `createSession`,
  `appendEvent`, `subscribeCommands` (lado runner) y `listSessions`, `subscribeEvents`,
  `sendCommand` (lado app), más auth.
- Implementar `backend-memory` (todo en RAM) que cumple esa interfaz.
**Criterio de éxito:** un test usa `backend-memory` para: crear sesión → append de evento →
recibirlo por la suscripción. Sin red, sin Supabase. *(Este fake te servirá para testear todo lo demás.)*

### Etapa 4 · Proyecto Supabase y esquema
**Objetivo:** la base de datos existe y aceptas datos.
**Pasos:**
- Crear proyecto Supabase (o levantar Supabase local con su CLI).
- Escribir las **migraciones SQL** de las tablas del modelo de datos.
- Habilitar Realtime en `events` y `commands`.
**Criterio de éxito:** desde el SQL editor insertas y lees filas de cada tabla.

---

# FASE 1 — Backend Supabase real (todavía sin agente)

### Etapa 5 · Implementar `backend-supabase`
**Objetivo:** la versión real de `BackendPort`.
**Pasos:**
- En `backend-supabase`, implementar la interfaz usando `supabase-js`: auth, CRUD de
  sessions/events/commands, y suscripciones vía Realtime (Postgres changes).
**Criterio de éxito:** test de integración contra Supabase local: insertas un evento desde un cliente
y otro cliente lo recibe por Realtime en < 1 s. *(El mismo test de la etapa 3, pero ahora con Supabase
de verdad — debe pasar igual porque la interfaz es la misma.)*

### Etapa 6 · Seguridad de filas (RLS)
**Objetivo:** que un usuario jamás vea datos de otro. **No opcional.**
**Pasos:**
- Activar Row Level Security en todas las tablas.
- Políticas: un usuario solo lee/escribe sus `machines`, `sessions`, `events`, `commands`.
- **Heads-up:** activar RLS suele romper queries que pasaban sin ella; **vuelve a correr los tests de
  integración de la Etapa 5** bajo RLS y ajusta lo que haga falta. Es esperado, no un retroceso.
**Criterio de éxito:** test con dos usuarios donde el usuario B **no puede** leer ni escribir nada del
usuario A (la consulta devuelve vacío o error, nunca datos ajenos); y los tests de la Etapa 5 siguen
pasando con RLS activa.

### Etapa 7 · Runner mínimo + emparejar la PC (pairing)
**Objetivo:** vincular tu runner a tu cuenta sin pegar secretos a mano.
**Pasos:**
- Bootstrap mínimo del runner: un CLI que arranca, **muestra un código corto** (device code) y se
  queda esperando. *(Todavía no se conecta a Realtime ni manda heartbeat; eso es la Etapa 8.)*
- Flujo "device code": la app (ya autenticada) canjea el código mediante una **Edge Function** que
  crea/asocia la `machine` y devuelve al runner una credencial propia (un JWT acotado, **nunca** el
  service-role key). El runner **guarda** esa credencial en disco para las etapas siguientes.
**Criterio de éxito:** arrancas el runner, ves un código, lo pegas en una pantalla de prueba, la
`machine` aparece vinculada a tu usuario y el runner deja guardada su credencial.

> **Por qué se parte aquí:** el pairing necesita que exista *algo* de runner para mostrar el código,
> pero el demonio completo (conexión persistente + heartbeat) depende a su vez de tener ya la
> credencial. Por eso la Etapa 7 entrega el bootstrap mínimo y la Etapa 8 construye el demonio encima.

---

# FASE 2 — Runner local + adaptador Claude Code (el corazón)

### Etapa 8 · El runner como demonio (heartbeat)
**Objetivo:** un demonio que vive en tu PC y se reporta.
**Pasos:**
- Sobre el runner mínimo de la Etapa 7: lee la credencial guardada, se conecta vía `BackendPort`, y
  manda **heartbeat** periódico actualizando `machines.last_seen`.
**Criterio de éxito:** corres el runner y en la BD ves la máquina pasar a `online`; la matas y a los
segundos pasa a `offline`.

### Etapa 9 · Contrato `AgentAdapter` + adaptador "echo"
**Objetivo:** definir cómo se enchufa cualquier agente, probándolo con uno falso.
**Pasos:**
- Definir la interfaz `AgentAdapter` (arrancar sesión, recibir comandos, emitir eventos).
- Implementar `adapters/echo`: lo que le mandas como `send_message` lo devuelve como `event:message`.
**Criterio de éxito:** creas una sesión echo, mandas un mensaje vía `commands`, y te llega el eco vía
`events`. Todo el "cableado" runner↔backend queda probado **sin depender aún de Claude**.

### Etapa 10 · Adaptador Claude Code — lanzar y capturar
**Objetivo:** ver actividad real de Claude.
**Pasos:**
- Integrar mediante el **Claude Agent SDK de TypeScript** (no parsear el stdout del CLI): encaja con
  el stack "todo TS" y expone de forma nativa el streaming de mensajes y los hooks/`canUseTool` que
  necesitará la Etapa 11. **Mapear su salida** a eventos del protocolo (`message`, `tool_call`, `plan_step`).
- **Credenciales de Anthropic:** definir cómo el runner las obtiene y guarda (API key o sesión de
  suscripción), separado del pairing de Supabase. Sin esto el adaptador no puede arrancar Claude.
- **Capturar recursos generados:** detectar los archivos que la IA produce o escribe (textos,
  imágenes, audios, vídeos, otros ficheros), subirlos a **Supabase Storage** y emitir un evento
  `artifact` con su referencia. Así todo lo que genera el agente queda disponible para la app.
- ⚠️ *Verificar al implementar* la forma exacta del SDK (nombres de callbacks, tipos de hooks,
  formato de streaming) contra la documentación vigente; aquí asumimos sus capacidades, no su firma exacta.
**Criterio de éxito:** das una instrucción simple y ves en `events` la secuencia real de lo que hace Claude.

### Etapa 11 · Adaptador Claude Code — permisos (el momento clave)
**Objetivo:** que Claude pida permiso y espere tu decisión, **sobreviviendo a cortes de red**.
**Pasos:**
- Usar el `canUseTool` / hook de **petición de permiso** del SDK → emitir `permission_required` con el
  **diff** (inline si es chico, o por referencia a Storage si es grande, según la Etapa 2).
- El adaptador **bloquea** al agente hasta recibir un `command` `approve` o `reject`.
- **Estado persistente, no solo stream:** la petición vive en la tabla `permissions` con estado
  `pending`. Si el runner pierde la conexión mientras espera, al reconectar **vuelve a leer** los
  permisos `pending` y se resuscribe; no depende de no haberse perdido el mensaje Realtime.
- **Timeout configurable:** si no llega decisión en X tiempo, marcar el permiso como `expired` y
  aplicar la política por defecto (rechazar). Nada de dejar a Claude colgado indefinidamente.
**Criterio de éxito:** Claude pide modificar un archivo y queda esperando; insertas a mano un `approve`
en `commands` y Claude continúa; pruebas también el `reject`; y compruebas que **matando y reabriendo
la conexión del runner** mientras está pendiente, la decisión se sigue aplicando al volver.

### Etapa 12 · Adaptador Claude Code — comandos entrantes
**Objetivo:** controlar a Claude por comandos, no solo permisos.
**Pasos:**
- Mapear `new_task`, `send_message`, `cancel` a la entrada de Claude.
- **Semántica de `cancel`:** definir qué significa cancelar a mitad de una tool (interrumpir tras la
  operación en curso, no a la fuerza), emitir un `event` de estado (`task_done` con motivo `cancelled`)
  y dejar la sesión en un estado limpio y conocido.
- Marcar cada command como `consumed` (idempotencia: no re-ejecutar al reconectar).
**Criterio de éxito:** mandas una tarea nueva por `commands` y Claude la ejecuta de principio a fin;
y al mandar `cancel` a media tarea, la sesión queda en estado `cancelled` sin trabajo a medias colgado.

---

# FASE 3 — App móvil/web (Expo) end-to-end

### Etapa 13 · Esqueleto Expo + auth
**Objetivo:** una app que compila en las 3 plataformas y permite login.
**Pasos:**
- Proyecto Expo (RN + RN Web), navegación, login con Supabase Auth.
- La app habla con el backend a través de un cliente que usa el mismo `BackendPort`.
**Criterio de éxito:** te logueas y ves una pantalla vacía en iOS, Android y web.

### Etapa 14 · Lista de sesiones
**Objetivo:** ver tus sesiones y su estado en vivo.
**Pasos:**
- Pantalla que lee `sessions` y se suscribe a cambios (estado, título, máquina).
**Criterio de éxito:** al crear una sesión desde el runner, aparece sola en la lista del móvil.

### Etapa 15 · Pantalla de sesión — stream de actividad
**Objetivo:** ver lo que hace el agente en tiempo real.
**Pasos:**
- Suscripción a `events` de la sesión; render por tipo (mensaje, tool_call, plan_step, error).
- **Recursos generados inline:** al recibir un `artifact`, previsualizarlo según su tipo —texto
  formateado, imagen, reproductor de audio, reproductor de vídeo— y ofrecer **descarga individual**
  (resolviendo la `ref` de Storage a una URL firmada de corta duración).
**Criterio de éxito:** Claude trabaja en la PC y en el móvil ves su actividad aparecer en vivo,
incluyendo poder ver y descargar un recurso (p. ej. una imagen) que la IA acaba de generar.

### Etapa 16 · Diff + Aprobar/Rechazar (¡el loop completo!)
**Objetivo:** decidir desde el teléfono.
**Pasos:**
- Al recibir `permission_required`, mostrar la **vista de diff** con botones Aprobar/Rechazar.
- Aprobar/rechazar escribe el `command` correspondiente.
**Criterio de éxito:** Claude pide permiso → te aparece el diff en el móvil → tocas Aprobar → Claude
continúa. **Aquí ya tienes el producto mínimo funcionando.**

### Etapa 17 · Caja de entrada (mandar tareas)
**Objetivo:** control total desde el bolsillo.
**Pasos:**
- Campo de texto para `send_message` / `new_task` y botón de `cancel`.
**Criterio de éxito:** desde el móvil le mandas una tarea a Claude y la ejecuta; puedes cancelarla.

---

# FASE 4 — Notificaciones push

### Etapa 18 · Registro de tokens de dispositivo
**Objetivo:** saber a qué teléfono notificar.
**Pasos:**
- Al abrir la app, pedir permiso de notificaciones y guardar el token en `device_tokens`.
**Criterio de éxito:** el token queda en la tabla asociado a tu usuario y plataforma.

### Etapa 19 · Disparar push en eventos clave
**Objetivo:** enterarte aunque la app esté cerrada.
**Pasos:**
- **Database Webhook** sobre `permission_required` y `task_done` → **Edge Function** → **FCM**
  (con deep-link a la sesión).
- Dejar **ntfy.sh** como alternativa de cero-fricción para desarrollo/self-host.
**Criterio de éxito:** con la app en segundo plano, te llega push "Claude necesita permiso" y al tocarla
abres directo la sesión. Lo mismo con "tarea terminada".

---

# FASE 5 — Robustez, seguridad y multi-agente

### Etapa 20 · Reconexión y estado
**Objetivo:** que nada se rompa al perder conexión.
**Pasos:**
- Manejar runner offline, sesiones huérfanas, reintentos, y la idempotencia de `commands`.
**Criterio de éxito:** matas el runner a media tarea; la app lo marca offline; al volver, retoma sin
duplicar comandos.

### Etapa 21 · Endurecer seguridad
**Objetivo:** cerrar el riesgo de ejecución remota sobre tu PC.
**Pasos:**
- Revisar todas las políticas RLS, rotación de tokens de pairing, alcance mínimo de credenciales.
- **Integridad de comandos, no solo privacidad.** El cifrado e2e protege la *confidencialidad* del
  diff, pero un command desde la nube **ejecuta código en tu PC**: si comprometen tu cuenta, controlan
  la máquina. Considerar **firmar** los comandos sensibles (la app firma con una clave que el backend
  no tiene; el runner verifica) y/o confirmación reforzada para acciones destructivas.
- *(Opcional, recomendado)* **cifrado extremo-a-extremo** de los payloads sensibles (diffs): los
  cifran runner y app con una clave que el backend nunca ve — así recuperas privacidad incluso usando
  un BaaS gestionado.
**Criterio de éxito:** checklist de seguridad pasada; un usuario no accede a nada ajeno; (si haces e2e)
en la BD los diffs se ven cifrados; (si firmas comandos) el runner rechaza un command con firma inválida.

### Etapa 22 · Segundo adaptador: Antigravity (prueba de "universal")
**Objetivo:** demostrar que añadir un agente es solo un adaptador.
**Pasos:**
- Implementar `adapters/antigravity` hablando con su Language Server (Connect RPC), mapeando a los
  **mismos** eventos/comandos.
- ⚠️ Interfaz no oficial: aislar bien este adaptador para que si Google la rompe no caiga el resto.
**Criterio de éxito:** una sesión de Antigravity aparece y se controla en la app **sin tocar app ni
backend**. Ese es tu diferenciador, demostrado.

### Etapa 23 · Multi-sesión y multi-máquina pulido
**Objetivo:** orquestar varios agentes/PCs a la vez.
**Pasos:**
- Cambiar entre sesiones/máquinas, badges de estado, agrupar por PC.
**Criterio de éxito:** dos agentes en paralelo (p. ej. Claude + Antigravity) gobernados cómodamente
desde una sola app.

---

# FASE 6 — Extras "premium, gratis" (post-MVP)

### Etapa 24 · Galería de recursos generados + exportar
**Objetivo:** ver y descargar **todo** lo que la IA ha producido, en un solo lugar.
**Pasos:**
- Pantalla que agrega los `artifact` de una sesión (y opcionalmente de toda una máquina/usuario),
  con **filtros por tipo** (texto, imagen, audio, vídeo, otros) y previsualización a pantalla completa.
- **Descarga individual y en lote** (p. ej. "descargar todo" como zip, o compartir vía el share-sheet
  nativo en móvil), resolviendo las `ref` a URLs firmadas.
- Respetar RLS y caducidad de las URLs firmadas; los binarios viven en Storage, la galería solo
  referencia.
**Criterio de éxito:** abres la galería de una sesión, filtras por "imágenes", previsualizas una y
descargas todos los recursos generados de una sola vez.

### Etapa 25 · Voz, historial y temas
**Objetivo:** las features que otros cobran.
**Pasos:**
- Dictado por voz (speech-to-text) para mandar tareas; historial persistente con búsqueda; temas.
**Criterio de éxito:** dictas una tarea por voz y el agente la ejecuta.

### Etapa 26 · Empaquetado "siempre prendido" + self-host
**Objetivo:** instalación de verdad.
**Pasos:**
- Runner como binario/instalador y **servicio del sistema** que arranca con la PC.
- Documentar el self-host de Supabase (gracias a la capa de abstracción, es viable).
**Criterio de éxito:** instalas el runner como servicio; reinicias la PC y el runner vuelve solo,
listo para recibir órdenes desde el móvil.

---

## Riesgos y cosas a vigilar

- **Seguridad = prioridad, no fase final.** Expones una máquina que ejecuta código arbitrario a un
  teléfono. RLS, pairing con credenciales acotadas y (idealmente) cifrado e2e son obligatorios.
- **Interfaces no oficiales** (Antigravity RPC, detalles internos de cada agente) pueden romperse en
  cualquier update. El protocolo estable y los adaptadores aislados son lo que te protege.
- **Costo de Supabase:** un agente "streaming" puede generar muchísimos eventos. **No** emitas un
  evento por token; agrupa por mensaje / tool_call. Vigila lecturas/escrituras de Realtime.
- **Costo de la IA en sí (no solo del BaaS):** dejar agentes corriendo gasta tokens reales de
  Anthropic. Es el gasto recurrente principal. Conviene visibilizar el consumo por sesión y, más
  adelante, poner topes/presupuesto para no llevarte sustos.
- **Push en iOS** necesita cuenta de Apple Developer + APNs; Android usa FCM. Por eso ntfy.sh queda
  como salida rápida para dev y self-host.
- **Mantenimiento de adaptadores:** es el costo recurrente del proyecto. Mantén cada adaptador chico,
  testeable contra el protocolo, y con su propio fragmento de pruebas (encaja con tu filosofía).

## Glosario rápido

- **Runner:** demonio en tu PC que lanza los agentes y traduce su actividad al protocolo.
- **Adaptador (`AgentAdapter`):** plugin por agente (Claude, Antigravity…). Añadir agente = un adaptador.
- **`BackendPort`:** interfaz que abstrae el BaaS; hoy Supabase, mañana lo que quieras.
- **Evento / Comando:** el idioma común. El runner emite eventos; la app emite comandos.
- **RLS (Row Level Security):** reglas de Postgres que garantizan que cada usuario solo ve lo suyo.

## El hito que importa

Cuando termines la **Etapa 16** ya tienes un producto usable de verdad (ver, aprobar/rechazar y
mandar tareas a Claude desde el móvil). Todo lo de antes construye hacia ahí; todo lo de después lo
hace robusto y universal. Si en algún punto hay que recortar, recorta de la Fase 6 hacia atrás, nunca
de la seguridad (Fase 5, etapas 6 y 21).
