-- Pulpo · e2e mutuo de diffs (3/3) — intercambio bidireccional de claves de cifrado
--
-- Para AUTENTICAR el emisor del diff, la app debe conocer la clave pública de
-- cifrado del runner, anclada en el emparejamiento (presencia física). El runner
-- la publica en `pairing_start`; la app la recibe en `pairing_claim` y la cachea
-- localmente — ya no confía en otra que aparezca en la BD. Ambas claves son
-- públicas; las privadas nunca salen de cada dispositivo.

alter table public.pairing_requests add column if not exists runner_box_public_key text;

-- pairing_start ahora acepta la clave pública de cifrado del runner. Cambia la
-- aridad (antes era sin argumentos), así que quitamos la versión de 0 args.
drop function if exists public.pairing_start();

create or replace function public.pairing_start(p_runner_box_public text default null)
returns json language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_code     text;
  v_secret   text := encode(gen_random_bytes(24), 'hex');
  v_attempts int := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    v_code := upper(encode(gen_random_bytes(4), 'hex'));
    begin
      insert into public.pairing_requests (device_code, device_secret, runner_box_public_key)
        values (v_code, v_secret, p_runner_box_public);
      exit;
    exception when unique_violation then
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
  return json_build_object('device_code', v_code, 'device_secret', v_secret);
end$$;
revoke execute on function public.pairing_start(text) from public;
grant execute on function public.pairing_start(text) to anon, authenticated;

-- pairing_claim devuelve la clave de cifrado del runner para que la app la ancle.
create or replace function public.pairing_claim(
  p_code text,
  p_public_key text default null,
  p_box_public text default null
)
returns json language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_uid        uuid := auth.uid();
  v_req        public.pairing_requests;
  v_machine_id uuid;
  v_token      text;
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;
  select * into v_req from public.pairing_requests where device_code = upper(p_code) for update;
  if not found then
    raise exception 'código de emparejamiento inválido';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'código ya usado';
  end if;
  if v_req.expires_at < now() then
    update public.pairing_requests set status = 'expired' where id = v_req.id;
    raise exception 'código expirado';
  end if;

  insert into public.machines (user_id, name, status)
    values (v_uid, 'Runner ' || left(v_req.device_code, 4), 'offline')
    returning id into v_machine_id;

  v_token := public._mint_runner_token(v_uid, v_machine_id);

  update public.pairing_requests
    set status = 'claimed', user_id = v_uid, machine_id = v_machine_id,
        runner_token = v_token, signer_public_key = p_public_key,
        box_public_key = p_box_public, claimed_at = now()
    where id = v_req.id;

  return json_build_object(
    'machine_id', v_machine_id,
    'runner_box_public_key', v_req.runner_box_public_key
  );
end$$;
revoke execute on function public.pairing_claim(text, text, text) from public;
grant execute on function public.pairing_claim(text, text, text) to authenticated;
