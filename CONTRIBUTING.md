# Contribuir a Pulpo

¡Gracias por tu interés! Pulpo es open source (MIT) y las contribuciones son
bienvenidas: issues, ideas, docs y código.

## Antes de empezar

- Para **fallos de seguridad**, no abras un issue público: sigue
  [SECURITY.md](SECURITY.md).
- Para cambios grandes, abre primero un **issue** para alinear el enfoque antes de
  invertir tiempo en un PR.
- Al contribuir, aceptas que tu aporte se licencie bajo **[MIT](LICENSE)**.

## Requisitos

- **Node.js ≥ 20**
- **pnpm 9** (`npm i -g pnpm@9` o `corepack enable`)
- **Docker** (solo para Supabase local / tests de integración)

## Puesta en marcha

```bash
pnpm install      # dependencias del monorepo
pnpm build        # compilar todos los paquetes (tsc -b)
pnpm test         # tests unitarios (Vitest)
```

Para levantar la app de punta a punta (Supabase + runner + Expo), sigue
[docs/SELF_HOST.md](docs/SELF_HOST.md). Convenciones y comandos del repo:
[AGENTS.md](AGENTS.md).

## Antes de abrir un PR (debe estar todo en verde)

```bash
pnpm build                       # compila
pnpm --filter @pulpo/app typecheck   # typecheck de la app Expo
pnpm test                        # tests
pnpm lint                        # ESLint
pnpm format                      # Prettier (formatea); o format:check para verificar
```

## Estilo de cambios

- **Cambios pequeños y enfocados.** Un PR = un tema.
- **Acompaña el código con tests** cuando aporta lógica (mira los `*.test.ts`
  existentes como guía; usa los backends/transportes simulados para no depender de
  red).
- **No subas secretos** (`.env`, claves, tokens). Ya están en `.gitignore`.
- Mensajes de commit claros; en español o inglés, en imperativo.
- Respeta la **capa de abstracción**: la app y el runner hablan con `BackendPort`,
  no con Supabase directamente. Añadir un agente = un **adaptador** (ver
  `packages/runner/src/adapters/`).

## Flujo de PR

1. Haz fork y crea una rama (`feat/...`, `fix/...`).
2. Implementa + tests; deja el set de verificación en verde.
3. Abre el PR con una descripción clara (qué, por qué, cómo probarlo). El CI debe
   pasar.

## Código de conducta

Participar implica respetar el [Código de Conducta](CODE_OF_CONDUCT.md).
