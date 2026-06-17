#!/usr/bin/env node
import { defaultCredentialPath } from "./credentials.js";
import { pair } from "./pair.js";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "pair") {
    const url = process.env.BATUTA_SUPABASE_URL;
    const anonKey = process.env.BATUTA_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("Falta configurar BATUTA_SUPABASE_URL y BATUTA_SUPABASE_ANON_KEY.");
      process.exit(1);
    }
    const credential = await pair({ url, anonKey });
    console.log(`\n✓ Emparejado. Máquina ${credential.machineId}.`);
    console.log(`  Credencial guardada en ${defaultCredentialPath()}`);
    return;
  }

  console.log("Batuta runner");
  console.log("Uso: batuta-runner pair");
  if (command && command !== "help" && command !== "--help") process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
