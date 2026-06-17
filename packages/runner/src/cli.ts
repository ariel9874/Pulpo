#!/usr/bin/env node
import { createSupabaseBackend } from "@batuta/backend-supabase";
import { EchoAdapter } from "./adapters/echo.js";
import { AgentRunner } from "./agent-runner.js";
import { loadCredential, defaultCredentialPath } from "./credentials.js";
import { RunnerDaemon } from "./daemon.js";
import { pair } from "./pair.js";

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
  const agents = new AgentRunner(backend, credential.machineId, [new EchoAdapter()]);
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

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "pair") return runPair();
  if (command === "run") return runDaemon();

  console.log("Batuta runner");
  console.log("Uso: batuta-runner <pair|run>");
  if (command && command !== "help" && command !== "--help") process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
