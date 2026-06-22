# AGENTS.md — guía para agentes de IA y colaboradores

Instrucciones para trabajar en **Pulpo** de forma productiva (las leen Claude Code,
opencode, Cursor, etc., y también humanos). Para el flujo de PR, ver
[CONTRIBUTING.md](CONTRIBUTING.md).

## Qué es

Monorepo **pnpm + TypeScript** (ESM, `"type": "module"`). Pulpo orquesta agentes de
IA desde el móvil/web; el _runner_ los ejecuta en la PC. La app y el runner hablan
con la interfaz **`BackendPort`**, nunca con Supabase directamente.

```
packages/protocol/         tipos + validadores zod + BackendPort (la fuente de verdad)
packages/backend-supabase/ BackendPort sobre supabase-js
packages/backend-memory/   BackendPort en memoria (para tests, sin red)
packages/runner/           demonio + adaptadores de agentes (claude-code, opencode, …)
apps/app/                  Expo (React Native + RN Web)
supabase/                  migraciones SQL + RLS + triggers
```

## Comandos (desde la raíz)

```bash
pnpm install                       # dependencias
pnpm build                         # tsc -b (compila todos los paquetes)
pnpm test                          # vitest run (unitarios)
pnpm --filter @pulpo/app typecheck # typecheck de la app Expo (aparte)
pnpm lint                          # eslint .
pnpm format                        # prettier --write  (format:check para verificar)
```

**Siempre** deja `build`, `test` y `lint` en verde antes de terminar.

## Convenciones

- **ESM:** imports con extensión `.js` en TypeScript (p. ej. `from "./foo.js"`).
- **Paquetes:** scope `@pulpo/*`; deps internas con `workspace:*`.
- **Validación en los bordes:** todo evento/comando se valida con los schemas zod de
  `@pulpo/protocol`. No metas datos sin validar a la BD.
- **Añadir un agente** = implementar `AgentAdapter` en
  `packages/runner/src/adapters/<nombre>/`. Mira `claude-code/` y `opencode/` como
  referencia: un **transporte inyectable** (real vs simulado) para poder testear sin
  red, y `capabilities()` que reporta modelos/flags por máquina. **No asumas el
  contrato de un CLI/SDK externo: verifícalo** (fue una lección real con `agy`).
- **Tests:** usa `MemoryBackend` y transportes simulados; las pruebas que necesitan
  Supabase son `*.integration.test.ts` y se saltan sin la BD local.
- **Seguridad:** los comandos se firman (Ed25519) y los diffs van cifrados e2e; no
  rompas esa cadena. Ver [SECURITY.md](SECURITY.md).

## Tests de integración (opcional, requiere Docker)

```bash
pnpm exec supabase start      # levanta Supabase local
pnpm exec supabase db reset   # aplica migraciones
# exporta las claves de `supabase status` y corre vitest
```

## Qué NO hacer

- No hables con Supabase saltándote `BackendPort`.
- No subas secretos (`.env`, claves, tokens).
- No introduzcas telemetría sin acordarlo (ver [PRIVACY.md](PRIVACY.md)).
- No fijes contenido generado por IA sin revisarlo (licencias/seguridad — ver
  [DISCLAIMER.md](DISCLAIMER.md)).
