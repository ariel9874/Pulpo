# Pulpo 🐙

[![CI](https://github.com/ariel9874/Pulpo/actions/workflows/ci.yml/badge.svg)](https://github.com/ariel9874/Pulpo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

**Orquesta tus agentes de IA desde el móvil y la web, mientras tu PC los ejecuta.**

Pulpo es una app **open source** que convierte tu teléfono en el **control remoto**
de los agentes de IA que corren en tu computadora. Como un pulpo que mueve varios
brazos a la vez: coordinas varios agentes desde donde estés, y tu PC —siempre
encendida— hace el trabajo. El móvil **no es el IDE**; es el mando.

> Estado: **alpha**, en construcción. Los cambios se registran en [CHANGELOG.md](CHANGELOG.md).

## ✨ Qué hace

- **Lanza tareas a agentes de IA** desde el móvil o el navegador; el _runner_ en tu
  PC las ejecuta en el directorio que elijas.
- **Agnóstica de agente:** un solo control remoto para varios agentes/empresas. Cada
  máquina **publica sus capacidades** (qué agentes hay, qué modelos, qué soporta) y
  la app se adapta sola.
- **Sigue la actividad en vivo:** mensajes, razonamiento, uso de herramientas y
  resultado, con render de Markdown, auto-scroll, timestamps, copiar y colapsar.
- **Aprobación de permisos** desde el móvil para acciones sensibles (en los agentes
  que lo soportan).
- **Selección de modelo y razonamiento** por tarea.
- **Seguro por diseño:** firma de comandos (Ed25519), cifrado extremo a extremo de
  los diffs, RLS por usuario y mínimo privilegio del runner — ver [SECURITY.md](SECURITY.md).
- **Self-hostable:** trae tu propio backend — **Supabase cloud (tu proyecto) o
  Supabase self-hosted** — y tu runner corre en tu PC; tú controlas tus datos. Los
  diffs van cifrados e2e (el backend no los lee). Ver [docs/SELF_HOST.md](docs/SELF_HOST.md).

## 🤖 Agentes soportados

| Agente                             | Estado           | Notas                                                                        |
| ---------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| **Claude Code** (Claude Agent SDK) | ✅               | Modelo y _effort_ por tarea, permisos, uso/tokens                            |
| **opencode**                       | ✅               | Catálogo multi-proveedor (vía su servidor); gating de permisos               |
| **Antigravity** (`agy`)            | ⏸️ No disponible | Su CLI no es automatizable _headless_ todavía; cableado listo para reactivar |
| **echo**                           | 🧪               | Agente de prueba, sin IA                                                     |

Añadir un agente nuevo es **un adaptador + una fila de capacidades**.

## 🏗️ Arquitectura (monorepo pnpm + TypeScript)

```
packages/
  protocol/          tipos del modelo + validadores (zod) + BackendPort
  backend-supabase/  implementación de BackendPort sobre supabase-js
  backend-memory/    implementación en memoria, para tests sin red
  runner/            demonio local + adaptadores de agentes
apps/
  app/               Expo (React Native + RN Web)
supabase/            migraciones SQL, RLS, triggers
```

La app y el runner nunca hablan con Supabase directamente: pasan por `BackendPort`.
Esa indirección es lo que hace posible el self-host y la portabilidad.

## 🚀 Inicio rápido

Requisitos: **Node.js ≥ 20**, **pnpm 9**, **Docker** (para Supabase local).

```bash
pnpm install          # dependencias
pnpm build            # compilar todos los paquetes
pnpm test             # tests (Vitest)
pnpm typecheck        # chequeo de tipos
pnpm lint             # ESLint
```

Para levantarlo de punta a punta (Supabase + emparejar el runner + la app), sigue
**[docs/SELF_HOST.md](docs/SELF_HOST.md)**.

## 🔒 Seguridad y privacidad

- Modelo de amenazas y mitigaciones: [SECURITY.md](SECURITY.md)
- Tratamiento de datos: [PRIVACY.md](PRIVACY.md)

> ⚠️ Pulpo ejecuta acciones de agentes de IA (comandos, edición de archivos) en tu
> PC. Pueden ser **destructivas**. Úsalo en un entorno acotado, con copias de
> seguridad, y revisa la [exención de responsabilidad](DISCLAIMER.md).

## ⚖️ Legal

- Licencia: **[MIT](LICENSE)**.
- **Aviso legal / exención de responsabilidad:** [DISCLAIMER.md](DISCLAIMER.md).
- **No afiliación:** proyecto independiente, sin relación con Anthropic, Google,
  OpenAI, SST (opencode) ni Supabase. Las marcas mencionadas son de sus dueños y se
  usan solo para indicar compatibilidad.

## 🤝 Contribuir

Las contribuciones son bienvenidas. Antes de un PR: `pnpm build`, `pnpm test`,
`pnpm lint` y `pnpm format` en verde. Al contribuir aceptas que tu aporte se
licencie bajo MIT.
