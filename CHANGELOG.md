# Changelog

Todos los cambios notables de Pulpo se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
proyecto usa [Versionado Semántico](https://semver.org/lang/es/). Aún en `0.x`: la
API y el protocolo pueden cambiar.

## [Unreleased]

### Added

- **Orquestación de agentes desde el móvil/web** con el _runner_ ejecutando en la
  PC; emparejamiento (pairing) PC↔cuenta.
- **Agnóstico de agente:** cada máquina publica sus **capacidades** (agentes
  disponibles, catálogo de modelos, soporte de effort/permisos/uso) y la app se
  adapta.
- **Adaptadores de agente:** Claude Code (Agent SDK), **opencode** (servidor + SDK,
  catálogo multi-proveedor, gating de permisos), y `echo` (prueba).
- **Selección de modelo y razonamiento (effort) por tarea.**
- **Hilo de chat** con render de Markdown, auto-scroll, timestamps, copiar mensaje y
  colapsar respuestas largas.
- **Borrar conversación** (cascada en la BD + limpieza de artifacts en Storage).
- **Notificaciones push** (vía ntfy en dev).
- **Documentación open source:** README, LICENSE (MIT), PRIVACY, DISCLAIMER,
  CONTRIBUTING, AGENTS, CODE_OF_CONDUCT, plantillas de issues/PR y CI (GitHub
  Actions).

### Changed

- **Rebrand a Pulpo** (antes "Batuta"): nombre, scope de paquetes `@pulpo/*`, CLI
  `pulpo-runner`, variables `PULPO_*`, credenciales `~/.pulpo`.
- El runner fija **modelo/effort por defecto** y reporta uso (tokens/coste) al
  terminar la tarea.

### Security

- **RLS por usuario** en todas las tablas; **firma de comandos** (Ed25519);
  **cifrado e2e** de diffs (X25519 `nacl.box`); **mínimo privilegio** del runner por
  máquina, incluido **Storage `artifacts` acotado por máquina**.
- El adaptador opencode **surfacea errores** del turno (p. ej. API key inválida) en
  vez de completar en silencio.

### Notes

- **Antigravity** (`agy`) queda **marcado no disponible**: su CLI no es automatizable
  _headless_ todavía (el cableado queda listo para reactivarlo).

[unreleased]: https://github.com/ariel9874/Pulpo/commits/main
