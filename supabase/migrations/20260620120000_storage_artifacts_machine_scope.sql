-- Pulpo · Endurecimiento — acotar Storage `artifacts` por máquina
--
-- Las políticas de la Etapa 15 filtraban los artifacts solo por carpeta
-- `=<user_id>`. Eso dejaba un hueco respecto al mínimo privilegio de la Etapa 21:
-- un token de runner robado (acotado a SU máquina por `pulpo_machine_id` en el
-- resto de tablas) podía, sin embargo, leer/escribir/borrar los artifacts de
-- TODAS las máquinas del usuario, porque Storage no miraba la máquina.
--
-- Aquí lo cerramos. La ruta es `<user_id>/<session_id>/<archivo>`, así que el
-- 2º segmento es el session_id. Si el token trae `pulpo_machine_id` (es un
-- runner) → solo accede a objetos cuya sesión pertenece a SU máquina. Si no lo
-- trae (es la app) → sigue viendo todo lo suyo, como antes. Comparamos el
-- segmento como texto contra `id::text` para no castear rutas arbitrarias a uuid
-- (un nombre malformado no debe romper la evaluación de la política).

drop policy if exists "artifacts_read_own" on storage.objects;
create policy "artifacts_read_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      public.runner_machine_id() is null
      or (storage.foldername(name))[2] in (
        select id::text from public.sessions where machine_id = public.runner_machine_id()
      )
    )
  );

drop policy if exists "artifacts_insert_own" on storage.objects;
create policy "artifacts_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      public.runner_machine_id() is null
      or (storage.foldername(name))[2] in (
        select id::text from public.sessions where machine_id = public.runner_machine_id()
      )
    )
  );

drop policy if exists "artifacts_delete_own" on storage.objects;
create policy "artifacts_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      public.runner_machine_id() is null
      or (storage.foldername(name))[2] in (
        select id::text from public.sessions where machine_id = public.runner_machine_id()
      )
    )
  );
