# Self-host de Batuta

Batuta es tuyo de punta a punta: el runner corre en tu PC y el backend puede ser
tu propio Supabase. Gracias a la capa de abstracción `BackendPort`, la app y el
runner no saben si hablan con Supabase Cloud o con uno autohospedado — solo
cambian las variables de entorno.

## 1. El runner "siempre prendido" (servicio del sistema)

El objetivo: instalas el runner como servicio, reinicias la PC y vuelve solo,
listo para recibir órdenes desde el móvil.

```bash
# 1) Empareja una vez (guarda la credencial en ~/.batuta/credentials.json)
batuta-runner pair

# 2) Instálalo como servicio del sistema (arranca al iniciar sesión y reintenta)
batuta-runner service install

# Estado / quitar
batuta-runner service status
batuta-runner service uninstall
```

Qué hace `service install` según el sistema:

| SO          | Mecanismo                                                | Dónde queda                                      |
| ----------- | -------------------------------------------------------- | ------------------------------------------------ |
| **Linux**   | unit de **systemd** (modo usuario), `Restart=on-failure` | `~/.config/systemd/user/batuta-runner.service`   |
| **macOS**   | **LaunchAgent** de launchd, `RunAtLoad` + `KeepAlive`    | `~/Library/LaunchAgents/dev.batuta.runner.plist` |
| **Windows** | **Tarea programada** (`schtasks`) al iniciar sesión      | Programador de tareas, tarea `batuta-runner`     |

- **Linux sin iniciar sesión:** para que arranque al encender (sin login), habilita
  _linger_: `loginctl enable-linger $USER`.
- El servicio ejecuta `batuta-runner run`, que carga la credencial de
  `~/.batuta` (o de `BATUTA_HOME` si lo personalizaste — el instalador propaga esa
  variable al servicio).

## 2. Supabase autohospedado

El backend de Batuta son migraciones SQL estándar + Realtime + Auth + Storage. Para
correrlo tú mismo:

1. **Levanta Supabase.** En local/desarrollo basta el CLI: `supabase start`. Para
   producción, sigue la guía oficial de _self-hosting_ (docker compose) de Supabase.
2. **Aplica las migraciones** de `supabase/migrations/` (esquema, RLS, pairing,
   storage, push, mínimo privilegio):
   ```bash
   supabase db reset      # local: reaplica todas
   # o, contra una instancia existente:
   supabase db push
   ```
3. **Configura el secreto del pairing.** Las RPC de emparejamiento mintean JWTs
   con `app.settings.jwt_secret`; debe coincidir con el `JWT secret` de tu
   instancia (mismo valor que firma los tokens de Supabase Auth).
4. **Apunta la app y el runner a tu instancia** (mismas claves que da
   `supabase status`):

   ```bash
   # App (Expo)
   EXPO_PUBLIC_SUPABASE_URL=...        # API URL
   EXPO_PUBLIC_SUPABASE_ANON_KEY=...   # anon key

   # Runner (para 'pair')
   BATUTA_SUPABASE_URL=...
   BATUTA_SUPABASE_ANON_KEY=...
   ```

5. **Push (opcional).** El trigger de push publica a [ntfy.sh](https://ntfy.sh)
   (sin credenciales). Si self-hosteas, asegúrate de tener `pg_net` disponible; para
   FCM/APNs nativo se cambiaría el cuerpo del trigger `notify_push`.

## 3. Por qué esto es posible

Ni la app ni el runner llaman a Supabase directamente: hablan con `BackendPort`
(ver `packages/protocol`). Hoy lo implementa `backend-supabase`; mañana, lo que
quieras. Esa indirección es lo que hace el self-host (y la portabilidad) viable.

Seguridad del despliegue: ver [`SECURITY.md`](../SECURITY.md).
