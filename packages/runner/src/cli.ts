#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseBackend } from "@batuta/backend-supabase";
import { AntigravityAdapter } from "./adapters/antigravity/index.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code/index.js";
import { EchoAdapter } from "./adapters/echo.js";
import { OpencodeAdapter } from "./adapters/opencode/index.js";
import { AgentRunner } from "./agent-runner.js";
import { loadCredential, defaultCredentialPath } from "./credentials.js";
import { RunnerDaemon } from "./daemon.js";
import { pair } from "./pair.js";
import { installService, serviceStatus, uninstallService, type ServiceContext } from "./service.js";

async function runPair(): Promise<void> {
  const url = process.env.BATUTA_SUPABASE_URL;
  const anonKey = process.env.BATUTA_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("Falta configurar BATUTA_SUPABASE_URL y BATUTA_SUPABASE_ANON_KEY.");
    process.exit(1);
  }
  const credential = await pair({ url, anonKey });
  console.log(`\n✓ Emparejado. Máquina ${credential.machineId}.`);
  console.log(`  Credencial guardada en ${defaultCredentialPath()}`);
}

async function runDaemon(): Promise<void> {
  const credential = await loadCredential();
  if (!credential) {
    console.error("No hay credencial. Ejecuta 'batuta-runner pair' primero.");
    process.exit(1);
  }
  const backend = createSupabaseBackend(credential.url, credential.anonKey, {
    accessToken: credential.token,
    userId: credential.userId,
  });
  const daemon = new RunnerDaemon(backend, credential.machineId);
  const agents = new AgentRunner(
    backend,
    credential.machineId,
    [new EchoAdapter(), new ClaudeCodeAdapter(), new AntigravityAdapter(), new OpencodeAdapter()],
    {
      ...(credential.signerPublicKey ? { signerPublicKey: credential.signerPublicKey } : {}),
      ...(credential.boxPublicKey ? { recipientBoxPublicKey: credential.boxPublicKey } : {}),
      ...(credential.senderBoxSecretKey
        ? { senderBoxSecretKey: credential.senderBoxSecretKey }
        : {}),
    },
  );
  if (credential.signerPublicKey) {
    console.log("🔒 Verificación de firma activada (solo ejecuto comandos firmados por tu app).");
  }
  if (credential.boxPublicKey) {
    console.log("🔐 Cifrado e2e de diffs activado (el backend no los ve en claro).");
  }
  await daemon.start();
  await agents.start();
  console.log(`Runner activo (máquina ${credential.machineId}). Ctrl+C para salir.`);

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log("\nApagando…");
    await agents.stop();
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

async function runService(action: string | undefined): Promise<void> {
  const home = process.env.BATUTA_HOME ?? join(homedir(), ".batuta");
  const ctx: ServiceContext = {
    nodePath: process.execPath,
    scriptPath: fileURLToPath(import.meta.url),
    workingDir: home,
    ...(process.env.BATUTA_HOME ? { env: { BATUTA_HOME: process.env.BATUTA_HOME } } : {}),
  };
  if (action === "install") return installService(ctx);
  if (action === "uninstall") return uninstallService();
  if (action === "status") {
    serviceStatus();
    return;
  }
  console.error("Uso: batuta-runner service <install|uninstall|status>");
  process.exit(1);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "pair") return runPair();
  if (command === "run") return runDaemon();
  if (command === "service") return runService(process.argv[3]);

  console.log("Batuta runner");
  console.log("Uso: batuta-runner <pair|run|service>");
  console.log("  pair                 empareja esta PC con tu cuenta");
  console.log("  run                  arranca el runner (en primer plano)");
  console.log("  service install      instala el runner como servicio del sistema");
  console.log("  service uninstall    quita el servicio");
  console.log("  service status       muestra el estado del servicio");
  if (command && command !== "help" && command !== "--help") process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
