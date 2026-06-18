import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

/** Plataformas en las que sabemos instalar el runner como servicio. */
export type ServicePlatform = "linux" | "darwin" | "win32";

export const SERVICE_NAME = "batuta-runner";
export const SERVICE_LABEL = "dev.batuta.runner";

export interface ServiceContext {
  /** Ejecutable de Node (normalmente `process.execPath`). */
  nodePath: string;
  /** Ruta absoluta al `cli.js` del runner. */
  scriptPath: string;
  /** Directorio de trabajo del servicio (BATUTA_HOME o ~/.batuta). */
  workingDir: string;
  /** Variables de entorno a inyectar (p. ej. BATUTA_HOME si está personalizado). */
  env?: Record<string, string>;
}

/** ¿Sabemos instalar un servicio en esta plataforma? Devuelve su id o null. */
export function supportedServicePlatform(p: NodeJS.Platform = platform()): ServicePlatform | null {
  return p === "linux" || p === "darwin" || p === "win32" ? p : null;
}

// =====================================================================
// Generadores puros de la definición de servicio (testeables)
// =====================================================================

/** Unit de systemd (Linux, modo usuario). Arranca al iniciar sesión y reintenta. */
export function systemdUnit(ctx: ServiceContext): string {
  const envLines = Object.entries(ctx.env ?? {}).map(([k, v]) => `Environment=${k}=${v}`);
  return [
    "[Unit]",
    "Description=Batuta runner (orquesta agentes de IA en esta PC)",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${ctx.nodePath} ${ctx.scriptPath} run`,
    `WorkingDirectory=${ctx.workingDir}`,
    ...envLines,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** LaunchAgent de launchd (macOS). RunAtLoad + KeepAlive = "siempre prendido". */
export function launchdPlist(ctx: ServiceContext): string {
  const envEntries = Object.entries(ctx.env ?? {});
  const envBlock =
    envEntries.length === 0
      ? ""
      : [
          "  <key>EnvironmentVariables</key>",
          "  <dict>",
          ...envEntries.flatMap(([k, v]) => [`    <key>${k}</key>`, `    <string>${v}</string>`]),
          "  </dict>",
        ].join("\n") + "\n";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ctx.nodePath}</string>
    <string>${ctx.scriptPath}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ctx.workingDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
${envBlock}</dict>
</plist>
`;
}

/** Argumentos de `schtasks` para crear la tarea al iniciar sesión (Windows). */
export function windowsCreateArgs(ctx: ServiceContext): string[] {
  const taskRun = `"${ctx.nodePath}" "${ctx.scriptPath}" run`;
  return ["/Create", "/TN", SERVICE_NAME, "/TR", taskRun, "/SC", "ONLOGON", "/RL", "LIMITED", "/F"];
}

export function windowsDeleteArgs(): string[] {
  return ["/Delete", "/TN", SERVICE_NAME, "/F"];
}

export function windowsQueryArgs(): string[] {
  return ["/Query", "/TN", SERVICE_NAME];
}

export function systemdUnitPath(home: string = homedir()): string {
  return join(home, ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}

export function launchdPlistPath(home: string = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

// =====================================================================
// Instalación / desinstalación / estado (efectos)
// =====================================================================

function run(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status === 0;
}

/** Instala el runner como servicio del sistema que arranca con la PC. */
export async function installService(ctx: ServiceContext): Promise<void> {
  const target = supportedServicePlatform();
  if (target === "linux") {
    const path = systemdUnitPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, systemdUnit(ctx), "utf8");
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", SERVICE_NAME]);
    console.log(`✓ Servicio systemd instalado en ${path}`);
    console.log("  Para que arranque sin iniciar sesión: loginctl enable-linger $USER");
  } else if (target === "darwin") {
    const path = launchdPlistPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, launchdPlist(ctx), "utf8");
    run("launchctl", ["unload", path]); // por si ya estaba
    run("launchctl", ["load", "-w", path]);
    console.log(`✓ LaunchAgent instalado en ${path}`);
  } else if (target === "win32") {
    if (!run("schtasks", windowsCreateArgs(ctx))) {
      throw new Error("No se pudo crear la tarea programada.");
    }
    run("schtasks", ["/Run", "/TN", SERVICE_NAME]); // arrancar ya, sin esperar al próximo login
    console.log(`✓ Tarea programada "${SERVICE_NAME}" creada (arranca al iniciar sesión).`);
  } else {
    throw new Error(`Plataforma no soportada para servicio: ${platform()}`);
  }
}

/** Quita el servicio del sistema. */
export async function uninstallService(): Promise<void> {
  const target = supportedServicePlatform();
  if (target === "linux") {
    run("systemctl", ["--user", "disable", "--now", SERVICE_NAME]);
    await rm(systemdUnitPath(), { force: true });
    console.log("✓ Servicio systemd eliminado.");
  } else if (target === "darwin") {
    const path = launchdPlistPath();
    run("launchctl", ["unload", "-w", path]);
    await rm(path, { force: true });
    console.log("✓ LaunchAgent eliminado.");
  } else if (target === "win32") {
    run("schtasks", windowsDeleteArgs());
    console.log("✓ Tarea programada eliminada.");
  } else {
    throw new Error(`Plataforma no soportada para servicio: ${platform()}`);
  }
}

/** Muestra el estado del servicio. */
export function serviceStatus(): void {
  const target = supportedServicePlatform();
  if (target === "linux") run("systemctl", ["--user", "status", SERVICE_NAME, "--no-pager"]);
  else if (target === "darwin") run("launchctl", ["list", SERVICE_LABEL]);
  else if (target === "win32") run("schtasks", windowsQueryArgs());
  else console.log(`Plataforma no soportada para servicio: ${platform()}`);
}
