-- Pulpo · Etapa 4 — Habilitar Realtime
--
-- Realtime entrega los cambios de Postgres a runner y app (es "el cable").
-- Suscribimos events y commands (el flujo principal) y también sessions y
-- permissions (lista en vivo y permisos pendientes). Idempotente.

-- La publicación supabase_realtime existe por defecto en Supabase; por si acaso:
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Añadir tablas a la publicación solo si no están ya.
do $$
declare
  t text;
begin
  foreach t in array array['events', 'commands', 'sessions', 'permissions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Para que los UPDATE/DELETE entreguen la fila completa por Realtime.
-- (events es append-only, no hace falta.)
alter table public.commands replica identity full;
alter table public.sessions replica identity full;
alter table public.permissions replica identity full;
