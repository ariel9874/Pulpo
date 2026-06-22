-- Pulpo · Etapa 5 — Privilegios de tablas para los roles de Supabase
--
-- En Supabase el patrón es: conceder privilegios a los roles (GRANT) y luego
-- restringir QUÉ filas ve cada usuario con RLS (Etapa 6). Sin estos GRANT, hasta
-- el service_role recibe "permission denied". El runner/app usan estos roles.

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

-- Mismos privilegios para tablas futuras del esquema public.
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to authenticated, service_role;
