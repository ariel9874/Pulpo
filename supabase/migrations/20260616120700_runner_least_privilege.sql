-- Batuta · Etapa 21 — Mínimo privilegio del token del runner
--
-- El token que mintea el pairing es un JWT de rol `authenticated` del usuario,
-- pero con un claim extra `batuta_machine_id` (plantado en la Etapa 7 justo para
-- esto). Hasta ahora ese claim no se usaba: un token de runner robado del disco
-- de UNA PC daba acceso a TODA la cuenta (todas las máquinas, sesiones, comandos,
-- diffs y tokens de push). Aquí lo acotamos por RLS a su propia máquina.
--
-- Modelo: si el JWT trae `batuta_machine_id` (es un runner) → solo ve/escribe lo
-- de ESA máquina. Si no lo trae (es la app, con sesión normal de Supabase) → ve
-- todo lo suyo, como antes. Así la app sigue siendo multi-máquina y el runner
-- queda confinado: un token filtrado no puede tocar otras máquinas ni los tokens
-- de push del usuario.

-- Máquina a la que está acotado el token actual, o NULL si es un token de app.
create or replace function public.runner_machine_id()
returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'batuta_machine_id', '')::uuid
$$;
grant execute on function public.runner_machine_id() to anon, authenticated;

-- =====================================================================
-- machines: el runner solo ve/toca su propia fila de máquina.
-- =====================================================================
drop policy if exists machines_own on public.machines;
create policy machines_own on public.machines
  for all to authenticated
  using (
    user_id = auth.uid()
    and (public.runner_machine_id() is null or id = public.runner_machine_id())
  )
  with check (
    user_id = auth.uid()
    and (public.runner_machine_id() is null or id = public.runner_machine_id())
  );

-- =====================================================================
-- sessions: el runner solo ve/crea sesiones de su máquina.
-- =====================================================================
drop policy if exists sessions_own on public.sessions;
create policy sessions_own on public.sessions
  for all to authenticated
  using (
    user_id = auth.uid()
    and (public.runner_machine_id() is null or machine_id = public.runner_machine_id())
  )
  with check (
    user_id = auth.uid()
    and machine_id in (select id from public.machines where user_id = auth.uid())
    and (public.runner_machine_id() is null or machine_id = public.runner_machine_id())
  );

-- =====================================================================
-- events: el runner solo ve/escribe eventos de sesiones de su máquina.
-- =====================================================================
drop policy if exists events_own on public.events;
create policy events_own on public.events
  for all to authenticated
  using (
    user_id = auth.uid()
    and (
      public.runner_machine_id() is null
      or session_id in (select id from public.sessions where machine_id = public.runner_machine_id())
    )
  )
  with check (
    user_id = auth.uid()
    and session_id in (select id from public.sessions where user_id = auth.uid())
    and (
      public.runner_machine_id() is null
      or session_id in (select id from public.sessions where machine_id = public.runner_machine_id())
    )
  );

-- =====================================================================
-- commands: el runner solo ve/consume comandos dirigidos a su máquina
-- (por machine_id directo, o por la sesión a la que apuntan).
-- =====================================================================
drop policy if exists commands_own on public.commands;
create policy commands_own on public.commands
  for all to authenticated
  using (
    user_id = auth.uid()
    and (
      public.runner_machine_id() is null
      or machine_id = public.runner_machine_id()
      or session_id in (select id from public.sessions where machine_id = public.runner_machine_id())
    )
  )
  with check (
    user_id = auth.uid()
    and (session_id is null or session_id in (select id from public.sessions where user_id = auth.uid()))
    and (machine_id is null or machine_id in (select id from public.machines where user_id = auth.uid()))
    and (
      public.runner_machine_id() is null
      or machine_id = public.runner_machine_id()
      or session_id in (select id from public.sessions where machine_id = public.runner_machine_id())
    )
  );

-- =====================================================================
-- permissions: el runner solo ve/escribe permisos de sesiones de su máquina.
-- =====================================================================
drop policy if exists permissions_own on public.permissions;
create policy permissions_own on public.permissions
  for all to authenticated
  using (
    user_id = auth.uid()
    and (
      public.runner_machine_id() is null
      or session_id in (select id from public.sessions where machine_id = public.runner_machine_id())
    )
  )
  with check (
    user_id = auth.uid()
    and session_id in (select id from public.sessions where user_id = auth.uid())
    and (
      public.runner_machine_id() is null
      or session_id in (select id from public.sessions where machine_id = public.runner_machine_id())
    )
  );

-- =====================================================================
-- device_tokens: son tokens de push de los dispositivos del usuario (los maneja
-- la app). Un runner no los necesita; con token acotado, NO ve ninguno.
-- =====================================================================
drop policy if exists device_tokens_own on public.device_tokens;
create policy device_tokens_own on public.device_tokens
  for all to authenticated
  using (user_id = auth.uid() and public.runner_machine_id() is null)
  with check (user_id = auth.uid() and public.runner_machine_id() is null);
