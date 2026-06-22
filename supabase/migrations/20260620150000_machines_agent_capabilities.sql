-- Pulpo · Capacidades de agentes por máquina (catálogo dinámico, opción B)
--
-- El runner descubre qué agentes están instalados/logueados en su PC y publica
-- sus capacidades (modelos disponibles, si soportan effort/permisos/uso) en esta
-- columna; la app la lee para adaptar la UI por máquina (catálogo de modelos por
-- agente, ocultar lo no soportado). JSONB array de AgentCapability del protocolo.

alter table public.machines
  add column if not exists agents jsonb not null default '[]'::jsonb;
