-- Batuta · Firma de comandos (3/3) — el pairing entrega la clave pública
--
-- La app genera un par Ed25519 (la privada nunca sale del dispositivo) y al
-- emparejar registra su clave PÚBLICA. El runner la recibe en el poll y la cachea
-- en su credencial; a partir de ahí verifica cada comando contra esa clave (ver
-- AgentRunner). El backend nunca tiene la privada: aunque comprometan la cuenta,
-- no pueden forjar comandos que el runner acepte. La clave queda anclada en el
-- emparejamiento (presencia física); el runner ya no confía en otra de la BD.

alter table public.pairing_requests add column if not exists signer_public_key text;

-- pairing_claim ahora acepta la clave pública (opcional, para compatibilidad).
-- Cambia la aridad, así que primero quitamos la versión de un solo argumento
-- para que una llamada con un argumento no quede ambigua.
drop function if exists public.pairing_claim(text);

create or replace function public.pairing_claim(p_code text, p_public_key text default null)
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
        runner_token = v_token, signer_public_key = p_public_key, claimed_at = now()
    where id = v_req.id;

  return json_build_object('machine_id', v_machine_id);
end$$;
revoke execute on function public.pairing_claim(text, text) from public;
grant execute on function public.pairing_claim(text, text) to authenticated;

-- pairing_poll ahora devuelve también la clave pública registrada.
create or replace function public.pairing_poll(p_code text, p_secret text)
returns json language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_req public.pairing_requests;
begin
  select * into v_req from public.pairing_requests where device_code = upper(p_code);
  if not found then
    raise exception 'código inválido';
  end if;
  if v_req.device_secret <> p_secret then
    raise exception 'secreto inválido' using errcode = '28000';
  end if;
  if v_req.status = 'pending' and v_req.expires_at < now() then
    return json_build_object('status', 'expired');
  end if;
  if v_req.status = 'claimed' then
    return json_build_object(
      'status', 'claimed',
      'token', v_req.runner_token,
      'machine_id', v_req.machine_id,
      'user_id', v_req.user_id,
      'signer_public_key', v_req.signer_public_key
    );
  end if;
  return json_build_object('status', v_req.status);
end$$;
revoke execute on function public.pairing_poll(text, text) from public;
grant execute on function public.pairing_poll(text, text) to anon, authenticated;
