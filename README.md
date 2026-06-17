# Batuta

App open source para **orquestar tus agentes de IA** (Claude Code, Antigravity, Codex…) desde el
móvil y la web, mientras tu PC se queda encendida ejecutándolos. El móvil es el **control remoto**,
no el IDE.

> Estado: en construcción. Ver [PLAN.md](PLAN.md) para el plan por etapas.

## Estructura (monorepo pnpm + TypeScript)

```
packages/
  protocol/          tipos del modelo + validadores (zod) + interfaz BackendPort
  backend-supabase/  implementación de BackendPort sobre supabase-js
  backend-memory/    implementación en memoria, para tests sin red
  runner/            demonio local + contrato AgentAdapter
apps/
  app/               Expo (React Native + RN Web)
supabase/            migraciones SQL, políticas RLS, Edge Functions
```

## Requisitos

- Node.js >= 20
- pnpm 9 (`npm install -g pnpm@9` o `corepack enable`)

## Comandos

```bash
pnpm install      # instalar dependencias
pnpm build        # compilar todos los paquetes
pnpm test         # correr tests (Vitest)
pnpm typecheck    # chequeo de tipos sin emitir
pnpm lint         # ESLint
pnpm format       # Prettier
```
