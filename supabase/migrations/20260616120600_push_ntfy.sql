-- Batuta · Etapa 19 — Disparar push en eventos clave (vía ntfy.sh)
--
-- Sin Edge Functions ni credenciales: un trigger en `events` publica a ntfy.sh
-- (usando pg_net) cuando el agente pide permiso o termina una tarea. Cada usuario
-- tiene su propio topic (derivado de su user_id) al que se suscribe con la app
-- ntfy. Para producción nativa (FCM/APNs) se cambiaría el cuerpo del trigger.

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_push()
returns trigger language plpgsql security definer
set search_path = public, extensions, net as $$
declare
  v_topic   text := 'batuta-' || replace(new.user_id::text, '-', '');
  v_title   text;
  v_message text;
begin
  if new.type = 'permission_required' then
    v_title := 'Claude pide permiso';
    v_message := coalesce(nullif(new.data ->> 'summary', ''), new.data ->> 'tool', 'Revisa la app');
  elsif new.type = 'task_done' then
    v_title := 'Tarea terminada';
    v_message := coalesce(new.data ->> 'outcome', 'completada');
  else
    return new;
  end if;

  perform net.http_post(
    url := 'https://ntfy.sh',
    body := jsonb_build_object(
      'topic', v_topic,
      'title', v_title,
      'message', v_message,
      'tags', array['robot']
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  return new;
end$$;

drop trigger if exists events_push on public.events;
create trigger events_push
  after insert on public.events
  for each row
  when (new.type in ('permission_required', 'task_done'))
  execute function public.notify_push();
