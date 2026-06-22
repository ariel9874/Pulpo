-- Pulpo · Etapa 7 — Emparejar la PC (device-code pairing)
--
-- Flujo:
--   1. El runner (clave anon) llama pairing_start() → recibe {device_code, device_secret}
--      y muestra device_code al usuario.
--   2. El usuario (autenticado en la app) llama pairing_claim(device_code) → crea su
--      machine y mintea un JWT de rol "authenticated" (sub = su user_id) para el runner.
--   3. El runner llama pairing_poll(device_code, device_secret) hasta recibir el token
--      y lo guarda en disco.
--
-- El token es un JWT acotado al rol authenticated del usuario (NUNCA el service_role).
-- Lleva además pulpo_machine_id para acotarlo por máquina en el endurecimiento (Etapa 21).
-- Todo vive en funciones SECURITY DEFINER (owner postgres); la tabla está bajo RLS sin
-- políticas, así que nadie la toca directo.

create table public.pairing_requests (
  id            uuid primary key default gen_random_uuid(),
  device_code   text not null unique,
  device_secret text not null,
  status        text not null default 'pending' check (status in ('pending', 'claimed', 'expired')),
  user_id       uuid references auth.users (id) on delete cascade,
  machine_id    uuid references public.machines (id) on delete set null,
  runner_token  text,
  expires_at    timestamptz not null default now() + interval '10 minutes',
  claimed_at    timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.pairing_requests enable row level security;
-- Sin políticas: acceso directo denegado a anon/authenticated. Solo las funciones
-- SECURITY DEFINER (owner postgres) operan sobre esta tabla.

-- base64url (sin padding) de un bytea.
create or replace function public._b64url(data bytea)
returns text language sql immutable as $$
  select rtrim(translate(encode(data, 'base64'), E'+/\n', '-_'), '=')
$$;
revoke execute on function public._b64url(bytea) from public;

-- Mintea un JWT HS256 válido para Supabase (rol authenticated, sub = usuario).
create or replace function public._mint_runner_token(p_user uuid, p_machine uuid)
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare
  secret        text := current_setting('app.settings.jwt_secret');
  header        text := public._b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'utf8'));
  payload       text := public._b64url(convert_to(json_build_object(
                    'sub', p_user::text,
                    'role', 'authenticated',
                    'aud', 'authenticated',
                    'iss', 'pulpo-pairing',
                    'iat', extract(epoch from now())::int,
                    'exp', extract(epoch from now() + interval '365 days')::int,
                    'pulpo_machine_id', p_machine::text
                  )::text, 'utf8'));
  signing_input text := header || '.' || payload;
  sig           text := public._b64url(hmac(signing_input, secret, 'sha256'));
begin
  return signing_input || '.' || sig;
end$$;
revoke execute on function public._mint_runner_token(uuid, uuid) from public;

-- El runner inicia el emparejamiento (clave anon).
create or replace function public.pairing_start()
returns json language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_code     text;
  v_secret   text := encode(gen_random_bytes(24), 'hex');
  v_attempts int := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    v_code := upper(encode(gen_random_bytes(4), 'hex')); -- 8 caracteres hex
    begin
      insert into public.pairing_requests (device_code, device_secret) values (v_code, v_secret);
      exit;
    exception when unique_violation then
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
  return json_build_object('device_code', v_code, 'device_secret', v_secret);
end$$;
revoke execute on function public.pairing_start() from public;
grant execute on function public.pairing_start() to anon, authenticated;

-- El usuario autenticado reclama el código: crea su machine y mintea el token del runner.
create or replace function public.pairing_claim(p_code text)
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
        runner_token = v_token, claimed_at = now()
    where id = v_req.id;

  return json_build_object('machine_id', v_machine_id);
end$$;
revoke execute on function public.pairing_claim(text) from public;
grant execute on function public.pairing_claim(text) to authenticated;

-- El runner consulta hasta que el código sea reclamado y recibe su token.
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
      'user_id', v_req.user_id
    );
  end if;
  return json_build_object('status', v_req.status);
end$$;
revoke execute on function public.pairing_poll(text, text) from public;
grant execute on function public.pairing_poll(text, text) to anon, authenticated;
