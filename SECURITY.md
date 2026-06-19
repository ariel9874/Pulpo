# Seguridad de Batuta

Batuta deja que tu móvil **ejecute código en tu PC** a través de un agente de IA.
Eso lo hace potente y peligroso a la vez: la superficie a proteger no es solo la
privacidad de tus datos, sino la **integridad del control remoto**. Este documento
describe el modelo de amenazas y el estado de cada mitigación.

## Arquitectura de confianza (resumen)

- **App** (móvil/web): se autentica contra Supabase Auth. Su JWT da acceso a
  _todos_ sus datos (es multi-máquina por diseño).
- **Runner** (PC): tras el _pairing_ recibe un JWT minteado de rol `authenticated`,
  con `sub = user_id` y un claim extra **`batuta_machine_id`**. **Nunca** usa el
  `service_role`.
- **Backend** (Supabase): Postgres + RLS + Storage + Realtime. El `service_role`
  (BYPASSRLS) solo lo usan tareas de servidor; jamás se entrega a app ni runner.

## Modelo de amenazas

| Amenaza                                                                            | Mitigación                                                                                                                                       | Estado        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Un usuario lee/escribe datos de **otro usuario**                                   | RLS `user_id = auth.uid()` en las 6 tablas + `with check` de propiedad del padre; Storage por carpeta `=<uid>`                                   | ✅            |
| Acceso directo a la tabla de **pairing**                                           | RLS habilitada **sin políticas**; solo funciones `security definer` (owner `postgres`) la tocan                                                  | ✅            |
| **Código de pairing** robado/forzado                                               | Código de un solo uso, expira en 10 min, `device_secret` de 24 bytes exigido en el `poll`                                                        | ✅            |
| **Token del runner** robado del disco de una PC                                    | **Mínimo privilegio**: RLS acota el token por `batuta_machine_id` → solo su máquina; no ve otras máquinas, sesiones, comandos ni tokens de push  | ✅ (Etapa 21) |
| **Cuenta de la app** comprometida → inyectan comandos que ejecutan código en tu PC | **Firma de comandos** (Ed25519): la app firma; el runner verifica con la pública que recibió al emparejar; la privada nunca sale del dispositivo | ✅            |
| El **BaaS gestionado** (o quien lo administre) lee tus diffs                       | Cifrado e2e de payloads sensibles (diff) entre app y runner                                                                                      | ⏳ diferido   |
| Token del runner válido **demasiado tiempo** (365 días)                            | Rotación/refresh del token del runner                                                                                                            | ⏳ diferido   |

## Checklist de seguridad

- [x] RLS habilitada en `machines`, `sessions`, `events`, `commands`, `permissions`,
      `device_tokens`.
- [x] Cada política exige `user_id = auth.uid()` y, al insertar, que el recurso
      padre referenciado también sea del usuario (`with check`).
- [x] `pairing_requests` bajo RLS sin políticas; toda la lógica en `security definer`
      con `search_path` fijo y `revoke execute … from public`.
- [x] El token del runner es rol `authenticated` (nunca `service_role`).
- [x] **Mínimo privilegio del runner**: el claim `batuta_machine_id` confina el token
      a su máquina (`public.runner_machine_id()` + políticas por máquina).
- [x] El runner **no** ve los tokens de push del usuario.
- [x] Storage `artifacts` privado, RLS por carpeta `=<user_id>`; descarga vía URL firmada.
- [x] Códigos de pairing de un solo uso y con expiración corta.
- [x] **Firma de comandos** (Ed25519): el runner solo ejecuta comandos firmados por la
      app; anti-replay por `nonce`. La pública se ancla al emparejar y se cachea en la
      credencial del runner (no se confía en otra de la BD después).
- [ ] Cifrado e2e de diffs.
- [ ] Rotación del token del runner.

## Verificación

Tests de integración (requieren Supabase local; se saltan sin entorno):

- `packages/backend-supabase/src/rls.integration.test.ts` — aislamiento entre usuarios.
- `packages/backend-supabase/src/runner_scope.integration.test.ts` — un token de runner
  solo accede a su propia máquina.
- `packages/protocol/src/signing.test.ts` + `packages/runner/src/agent-runner.test.ts`
  — firma/verificación y rechazo de comandos sin firma/alterados/replay.

Cómo correrlos: ver [`memory/run-integration-tests.md`] (Supabase local + exportar el
entorno de `supabase status` antes de `vitest`).

## Firma de comandos: cómo y por qué

La app genera un par Ed25519 al emparejar; la **privada vive solo en el dispositivo**
y la **pública se registra en el `pairing_claim`** (presencia física). El runner la
recibe en el `poll`, la **cachea en su credencial** y desde entonces verifica cada
comando contra ESA clave — ya no confía en otra que aparezca en la BD. Como el backend
nunca tiene la privada, comprometer la cuenta no basta para forjar un comando que el
runner acepte. El `nonce` por comando da anti-replay; no se valida `issuedAt` como
caducidad para no romper el catch-up de comandos legítimamente viejos (Etapa 20).

Una máquina emparejada **con** clave exige firma; **sin** clave (apps antiguas) no
exige nada — rollout gradual sin romper lo existente.

## Lo que aún se difiere

- **Cifrado e2e de los diffs**: que el BaaS no pueda leer los payloads sensibles.
- **Rotación del token del runner**: hoy vive 365 días (mitigado por mínimo privilegio).
