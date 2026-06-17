-- Batuta · Etapa 15 — Storage para recursos generados por la IA
--
-- Bucket privado "artifacts". Convención de ruta: <user_id>/<session_id>/<archivo>.
-- RLS por usuario: cada quien solo accede a su propia carpeta. La app resuelve
-- una URL firmada para previsualizar/descargar; el runner sube ahí los recursos.

insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;

-- storage.objects ya tiene RLS habilitada en Supabase; añadimos políticas.
create policy "artifacts_read_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'artifacts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "artifacts_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'artifacts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "artifacts_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'artifacts' and (storage.foldername(name))[1] = auth.uid()::text);
