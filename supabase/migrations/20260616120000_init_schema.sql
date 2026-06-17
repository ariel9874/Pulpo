-- Batuta · Etapa 4 — Esquema inicial
--
-- Tablas del modelo de datos (ver PLAN.md). Las columnas van en snake_case;
-- el paquete backend-supabase (Etapa 5) las mapea a los tipos camelCase del
-- protocolo. Cada tabla lleva user_id para poder activar RLS en la Etapa 6.
--
-- NOTA: aquí NO se activa Row Level Security; eso es la Etapa 6 (migración aparte).

-- =====================================================================
-- machines · PCs registradas (1 por runner)
-- =====================================================================
create table if not exists public.machines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(name) > 0),
  status      text not null default 'offline' check (status in ('online', 'offline')),
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists machines_user_id_idx on public.machines (user_id);

-- =====================================================================
-- sessions · una sesión de agente
-- =====================================================================
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  machine_id  uuid not null references public.machines (id) on delete cascade,
  agent_type  text not null check (length(agent_type) > 0),
  title       text not null default '',
  status      text not null default 'starting'
              check (status in ('starting', 'running', 'waiting_permission',
                                'waiting_input', 'done', 'error', 'cancelled')),
  cwd         text not null check (length(cwd) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sessions_user_id_idx on public.sessions (user_id);
create index if not exists sessions_machine_id_idx on public.sessions (machine_id);

-- =====================================================================
-- events · actividad del agente (append-only). runner escribe, app lee.
-- =====================================================================
create table if not exists public.events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  session_id        uuid not null references public.sessions (id) on delete cascade,
  protocol_version  integer not null default 1,
  type              text not null,
  -- campos específicos de cada variante del evento (text, role, tool, diff, artifact…)
  data              jsonb not null default '{}'::jsonb,
  ts                timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists events_session_id_ts_idx on public.events (session_id, ts);
create index if not exists events_user_id_idx on public.events (user_id);

-- =====================================================================
-- commands · órdenes de la app. app escribe, runner lee.
-- =====================================================================
create table if not exists public.commands (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- new_task apunta a una máquina (aún no hay sesión); el resto, a una sesión.
  machine_id        uuid references public.machines (id) on delete cascade,
  session_id        uuid references public.sessions (id) on delete cascade,
  protocol_version  integer not null default 1,
  type              text not null,
  data              jsonb not null default '{}'::jsonb,
  ts                timestamptz not null default now(),
  -- idempotencia: el runner lo marca consumido al procesarlo.
  consumed_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint commands_target_present
    check (machine_id is not null or session_id is not null)
);
create index if not exists commands_machine_id_idx on public.commands (machine_id);
create index if not exists commands_session_id_idx on public.commands (session_id);
create index if not exists commands_unconsumed_idx
  on public.commands (machine_id) where consumed_at is null;

-- =====================================================================
-- permissions · petición de permiso con su diff + decisión
-- =====================================================================
create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  session_id  uuid not null references public.sessions (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected', 'expired')),
  tool        text,
  summary     text,
  -- diff inline o por referencia a Storage (ver convención de payloads grandes).
  diff        jsonb,
  expires_at  timestamptz,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists permissions_session_id_idx on public.permissions (session_id);
create index if not exists permissions_pending_idx
  on public.permissions (session_id) where status = 'pending';

-- =====================================================================
-- device_tokens · tokens de push (FCM) por dispositivo
-- =====================================================================
create table if not exists public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  token       text not null,
  platform    text not null check (platform in ('ios', 'android', 'web')),
  created_at  timestamptz not null default now(),
  unique (user_id, token)
);
create index if not exists device_tokens_user_id_idx on public.device_tokens (user_id);

-- updated_at automático en sessions
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();
