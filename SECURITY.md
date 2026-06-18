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

| Amenaza                                                                            | Mitigación                                                                                                                                      | Estado        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Un usuario lee/escribe datos de **otro usuario**                                   | RLS `user_id = auth.uid()` en las 6 tablas + `with check` de propiedad del padre; Storage por carpeta `=<uid>`                                  | ✅            |
| Acceso directo a la tabla de **pairing**                                           | RLS habilitada **sin políticas**; solo funciones `security definer` (owner `postgres`) la tocan                                                 | ✅            |
| **Código de pairing** robado/forzado                                               | Código de un solo uso, expira en 10 min, `device_secret` de 24 bytes exigido en el `poll`                                                       | ✅            |
| **Token del runner** robado del disco de una PC                                    | **Mínimo privilegio**: RLS acota el token por `batuta_machine_id` → solo su máquina; no ve otras máquinas, sesiones, comandos ni tokens de push | ✅ (Etapa 21) |
| **Cuenta de la app** comprometida → inyectan comandos que ejecutan código en tu PC | Firma de comandos (la app firma; el runner verifica con clave que el backend no tiene)                                                          | ⏳ diferido   |
| El **BaaS gestionado** (o quien lo administre) lee tus diffs                       | Cifrado e2e de payloads sensibles (diff) entre app y runner                                                                                     | ⏳ diferido   |
| Token del runner válido **demasiado tiempo** (365 días)                            | Rotación/refresh del token del runner                                                                                                           | ⏳ diferido   |

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
- [ ] Firma de comandos (integridad ante cuenta comprometida).
- [ ] Cifrado e2e de diffs.
- [ ] Rotación del token del runner.

## Verificación

Tests de integración (requieren Supabase local; se saltan sin entorno):

- `packages/backend-supabase/src/rls.integration.test.ts` — aislamiento entre usuarios.
- `packages/backend-supabase/src/runner_scope.integration.test.ts` — un token de runner
  solo accede a su propia máquina.

Cómo correrlos: ver [`memory/run-integration-tests.md`] (Supabase local + exportar el
entorno de `supabase status` antes de `vitest`).

## Por qué se difieren firma y cifrado e2e

Son mejoras valiosas pero **no** condiciones del MVP, y cada una añade gestión de
claves (generación, intercambio en el pairing, almacenamiento por dispositivo) que
merece su propia etapa. El mínimo privilegio de esta etapa ya reduce drásticamente el
radio de impacto de la fuga más probable (el token en el disco de una PC). La firma de
comandos cierra el escenario de **cuenta comprometida** y es el siguiente paso natural
de endurecimiento.
