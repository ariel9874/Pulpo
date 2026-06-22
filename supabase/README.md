# supabase/

Migraciones SQL, políticas RLS y Edge Functions de Pulpo.

## Migraciones

- `migrations/20260616120000_init_schema.sql` — tablas del modelo de datos
  (machines, sessions, events, commands, permissions, device_tokens).
- `migrations/20260616120100_enable_realtime.sql` — publica las tablas en
  `supabase_realtime` y ajusta `replica identity`.

La **RLS** se añade en la Etapa 6 (migración aparte). Las columnas van en
`snake_case`; el paquete `backend-supabase` (Etapa 5) las mapea a los tipos
`camelCase` del protocolo.

## Levantar en local (Docker)

```bash
pnpm dlx supabase init     # solo la primera vez (crea config.toml)
pnpm dlx supabase start    # arranca el stack local en Docker
pnpm dlx supabase db reset # aplica las migraciones desde cero
```

`supabase start` imprime las URLs y claves locales (API URL, anon key,
service_role key) que usará `backend-supabase`.
