# Política de privacidad

> **No es asesoría legal.** Describe cómo trata los datos el software Pulpo tal
> como se publica. Si lo operas para terceros, adapta y revisa esta política con un
> abogado según tu jurisdicción (GDPR, CCPA, etc.).

Pulpo es **open source y self-hostable**: tú decides dónde vive el backend —tu
**propio proyecto de Supabase (cloud o self-hosted)**— y el _runner_ corre en tu
PC. **Quien opera el backend es el responsable del tratamiento de los datos.** Los
autores del proyecto **no operan un servicio central** ni reciben tus datos. (Nota:
con Supabase Cloud, los datos viven en la infraestructura gestionada de Supabase,
bajo **tu** cuenta; para control total de la infraestructura, usa Supabase
self-hosted.)

## 1. Qué datos se manejan

| Dato                                                    | Dónde vive                 | Para qué                                                          |
| ------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| **Email / cuenta**                                      | Tu Supabase (Auth)         | Iniciar sesión e identificar al usuario                           |
| **Sesiones y mensajes del chat** (`sessions`, `events`) | Tu Supabase                | Mostrar el hilo del agente                                        |
| **Comandos** (`commands`)                               | Tu Supabase                | Órdenes de la app al runner                                       |
| **Permisos y diffs** (`permissions`)                    | Tu Supabase                | Aprobar/rechazar acciones; los **diffs van cifrados**             |
| **Artifacts** (archivos generados)                      | Tu Supabase Storage        | Previsualizar/descargar; acotados por usuario y máquina           |
| **Máquinas y capacidades** (`machines`)                 | Tu Supabase                | Saber qué runner/agentes hay                                      |
| **Tokens de push** (`device_tokens`)                    | Tu Supabase                | Enviar notificaciones                                             |
| **Clave de firma / cifrado del dispositivo**            | **Solo en tu dispositivo** | Firmar comandos y descifrar diffs; **nunca sale del dispositivo** |

## 2. Qué sale de tu equipo (importante)

- **Hacia el modelo de IA:** para que un agente trabaje, **el contenido de los
  archivos que lee y tus prompts se envían al proveedor del modelo** que elijas
  (tú aportas la clave/credencial). Esto es inherente a cualquier agente de IA. El
  proveedor trata esos datos según **su** política de privacidad.
- **Cifrado extremo a extremo de diffs:** los diffs de permisos se sellan
  (NaCl box) hacia la clave pública de tu app; **el backend no puede leerlos**
  (ver [SECURITY.md](SECURITY.md)).
- **Notificaciones push:** en el modo por defecto (dev) se publica a
  [ntfy.sh](https://ntfy.sh) en un _topic_ derivado de tu `user_id`, con el
  **título y mensaje** de la notificación (no el contenido del chat). Cámbialo a
  FCM/APNs propio para producción.

## 3. Telemetría

**Pulpo en sí no recoge telemetría ni analítica** y no envía datos a los autores.
⚠️ Sin embargo, los **agentes y CLIs de terceros** que ejecutes (p. ej. Claude
Code, opencode) **pueden tener su propia telemetría**; revisa y configura la de
cada uno por separado.

## 4. Terceros (encargados/procesadores) posibles

Según cómo lo configures, pueden intervenir: **Supabase** (backend que tú
hospedas/contratas), el **proveedor de modelos** que conectes (p. ej. Anthropic,
OpenAI, Google, OpenCode Zen), **ntfy.sh** y/o el servicio de **push** (Expo /
FCM / APNs). Cada uno trata datos según sus propios términos.

## 5. Tus controles y derechos

- **Borrar una conversación:** elimina la sesión y, en cascada, sus mensajes,
  comandos y permisos, **y sus artifacts de Storage**.
- **Cerrar sesión / borrar cuenta:** desde la app o tu panel de Supabase.
- **Self-host:** al controlar tu Supabase, puedes exportar o borrar cualquier dato
  directamente.
- Según tu jurisdicción, puedes tener derechos de acceso, rectificación,
  supresión y portabilidad; al ser self-host, los ejerces sobre tu propia
  instancia.

## 6. Seguridad

El modelo de amenazas y las mitigaciones (RLS por usuario, firma de comandos
Ed25519, cifrado e2e de diffs, mínimo privilegio del runner, Storage acotado por
máquina) están en [SECURITY.md](SECURITY.md). Ningún sistema es 100% seguro; ver
la [exención de responsabilidad](DISCLAIMER.md).

## 7. Menores

Pulpo no está dirigido a menores de edad y no recoge conscientemente sus datos.

## 8. Cambios

Esta política puede actualizarse; la versión vigente es la de este repositorio.

---

Ver también: [LICENSE](LICENSE) · [Aviso legal](DISCLAIMER.md) · [Seguridad](SECURITY.md)
