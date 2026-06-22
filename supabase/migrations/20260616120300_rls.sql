-- Pulpo · Etapa 6 — Row Level Security (NO opcional)
--
-- Cada usuario solo ve y escribe lo suyo: user_id = auth.uid(). Además, al
-- insertar filas que referencian otra tabla (eventos→sesión, sesión→máquina…)
-- se exige que lo referenciado también sea del usuario, para que nadie cuelgue
-- datos propios de recursos ajenos. El rol service_role tiene BYPASSRLS, así que
-- las Edge Functions de servicio siguen funcionando.

alter table public.machines enable row level security;
alter table public.sessions enable row level security;
alter table public.events enable row level security;
alter table public.commands enable row level security;
alter table public.permissions enable row level security;
alter table public.device_tokens enable row level security;

-- machines
create policy machines_own on public.machines
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- sessions: la máquina referida debe ser del usuario.
create policy sessions_own on public.sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and machine_id in (select id from public.machines where user_id = auth.uid())
  );

-- events: la sesión referida debe ser del usuario.
create policy events_own on public.events
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and session_id in (select id from public.sessions where user_id = auth.uid())
  );

-- commands: la sesión y/o la máquina referidas deben ser del usuario.
create policy commands_own on public.commands
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (session_id is null or session_id in (select id from public.sessions where user_id = auth.uid()))
    and (machine_id is null or machine_id in (select id from public.machines where user_id = auth.uid()))
  );

-- permissions: la sesión referida debe ser del usuario.
create policy permissions_own on public.permissions
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and session_id in (select id from public.sessions where user_id = auth.uid())
  );

-- device_tokens
create policy device_tokens_own on public.device_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
