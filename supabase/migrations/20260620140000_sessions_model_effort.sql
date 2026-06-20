-- Batuta · Selección de modelo y razonamiento por sesión (Fase B)
--
-- La app elige modelo y nivel de razonamiento (effort) al crear la tarea; el
-- runner los lee de la sesión y los pasa al Agent SDK. Columnas opcionales: las
-- sesiones existentes (y los agentes no-Claude) las dejan en NULL y el runner
-- aplica sus defaults.

alter table public.sessions
  add column if not exists model  text,
  add column if not exists effort text check (effort in ('low', 'medium', 'high', 'xhigh', 'max'));
