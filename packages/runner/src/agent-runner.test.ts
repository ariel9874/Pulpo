import { MemoryBackend } from "@batuta/backend-memory";
import {
  boxOpen,
  generateBoxKeyPair,
  generateSigningKeyPair,
  openSealed,
  signCommand,
} from "@batuta/protocol";
import { describe, expect, it } from "vitest";
import type { AgentAdapter, AgentSession, StartParams } from "./agent-adapter.js";
import { EchoAdapter } from "./adapters/echo.js";
import { AgentRunner } from "./agent-runner.js";

/** Adaptador de prueba que, al arrancar, pide un permiso con un diff. */
class PermissionAdapter implements AgentAdapter {
  readonly agentType = "claude-code" as const;
  constructor(private readonly diff: string) {}
  async capabilities() {
    return {
      agentType: this.agentType,
      label: "Claude Code",
      available: true,
      models: [],
      supportsEffort: true,
      supportsPermissions: true,
      supportsUsage: true,
    };
  }
  async start(params: StartParams): Promise<AgentSession> {
    void params.requestPermission({ tool: "Write", title: "escribe archivo", diff: this.diff });
    return {
      sendMessage: async () => {},
      cancel: async () => {},
      dispose: async () => {},
    };
  }
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("AgentRunner + EchoAdapter (cableado con MemoryBackend)", () => {
  it("new_task crea sesión y emite el eco; send_message responde con eco", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/tmp",
      prompt: "hola",
    });

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: hola",
      ),
    );

    await backend.sendCommand({ type: "send_message", sessionId: session.id, text: "mundo" });
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: mundo",
      ),
    );

    await runner.stop();
  });

  it("cancel marca la sesión como cancelled", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "p",
    });
    const session = await waitFor(async () => (await backend.listSessions())[0]);

    await backend.sendCommand({ type: "cancel", sessionId: session.id });
    const cancelled = await waitFor(async () => {
      const s = (await backend.listSessions()).find((x) => x.id === session.id);
      return s?.status === "cancelled" ? s : undefined;
    });
    expect(cancelled.status).toBe("cancelled");

    await runner.stop();
  });

  it("marca los comandos como consumidos (idempotencia)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    const command = await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "p",
    });
    await waitFor(async () => (backend.isCommandConsumed(command.id) ? true : undefined));
    expect(backend.isCommandConsumed(command.id)).toBe(true);

    await runner.stop();
  });

  it("procesa comandos pendientes al arrancar (catch-up tras reconexión)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });

    // Comando enviado ANTES de que el runner se suscriba (simula un corte de red).
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "hola",
    });

    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start(); // el catch-up procesa el comando pendiente

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: hola",
      ),
    );

    await runner.stop();
  });
});

describe("AgentRunner — reconexión y estado (Etapa 20)", () => {
  it("una reconexión recupera el comando perdido durante el corte, sin duplicar", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    // Corte de red: el comando se guarda pero no se entrega en vivo.
    backend.simulateOutage(machine.id);
    const command = await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "hola",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(await backend.listSessions()).toHaveLength(0);
    expect(backend.isCommandConsumed(command.id)).toBe(false);

    // Vuelve la conexión → catch-up procesa el comando pendiente.
    backend.simulateReconnect(machine.id);
    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: hola",
      ),
    );

    // Otra reconexión NO duplica (el comando ya está consumido + dedup).
    backend.simulateReconnect(machine.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(await backend.listSessions()).toHaveLength(1);

    await runner.stop();
  });

  it("al arrancar cierra las sesiones huérfanas (runner muerto a media tarea)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    // Sesión que quedó "running" + un permiso pendiente de una ejecución previa.
    const orphan = await backend.createSession({
      machineId: machine.id,
      agentType: "echo",
      title: "vieja",
      cwd: "/x",
      status: "running",
    });
    await backend.createPermission({
      sessionId: orphan.id,
      tool: "Write",
      summary: "escribe algo",
    });

    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner.start();

    const closed = (await backend.listSessions()).find((s) => s.id === orphan.id);
    expect(closed?.status).toBe("error");
    const events = await backend.listEvents(orphan.id);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(await backend.listPendingPermissions(orphan.id)).toHaveLength(0);

    await runner.stop();
  });

  it("no toca sesiones de otra máquina ni las ya terminadas", async () => {
    const backend = new MemoryBackend();
    const mine = await backend.registerMachine({ name: "mía" });
    const other = await backend.registerMachine({ name: "otra" });
    const otherSession = await backend.createSession({
      machineId: other.id,
      agentType: "echo",
      title: "ajena",
      cwd: "/x",
      status: "running",
    });
    const doneSession = await backend.createSession({
      machineId: mine.id,
      agentType: "echo",
      title: "hecha",
      cwd: "/x",
      status: "done",
    });

    const runner = new AgentRunner(backend, mine.id, [new EchoAdapter()]);
    await runner.start();

    const sessions = await backend.listSessions();
    expect(sessions.find((s) => s.id === otherSession.id)?.status).toBe("running");
    expect(sessions.find((s) => s.id === doneSession.id)?.status).toBe("done");

    await runner.stop();
  });

  it("reiniciar el runner no re-ejecuta un comando ya consumido y cierra la huérfana", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });

    const runner1 = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner1.start();
    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "echo",
      cwd: "/x",
      prompt: "hola",
    });
    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await runner1.stop(); // muere dejando la sesión "running"

    // Reinicio: nuevo runner. El new_task ya está consumido.
    const runner2 = new AgentRunner(backend, machine.id, [new EchoAdapter()]);
    await runner2.start();
    await new Promise((r) => setTimeout(r, 30));

    const sessions = await backend.listSessions();
    expect(sessions).toHaveLength(1); // no se duplicó el comando
    expect(sessions.find((s) => s.id === session.id)?.status).toBe("error"); // huérfana cerrada

    await runner2.stop();
  });
});

describe("AgentRunner — firma de comandos (integridad)", () => {
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const newTask = (machineId: string) => ({
    type: "new_task" as const,
    machineId,
    agentType: "echo" as const,
    cwd: "/x",
    prompt: "hola",
  });

  it("ejecuta un new_task firmado correctamente", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const { publicKey, privateKey } = generateSigningKeyPair();
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()], {
      signerPublicKey: publicKey,
    });
    await runner.start();

    await backend.sendCommand(signCommand(privateKey, newTask(machine.id)));

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    await waitFor(async () =>
      (await backend.listEvents(session.id)).find(
        (e) => e.type === "message" && e.text === "echo: hola",
      ),
    );

    await runner.stop();
  });

  it("rechaza un comando SIN firma cuando hay clave configurada", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const { publicKey } = generateSigningKeyPair();
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()], {
      signerPublicKey: publicKey,
      onError: () => {}, // se espera un error de rechazo
    });
    await runner.start();

    await backend.sendCommand(newTask(machine.id));
    await settle();
    expect(await backend.listSessions()).toHaveLength(0);

    await runner.stop();
  });

  it("rechaza un comando firmado por OTRA clave", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const { publicKey } = generateSigningKeyPair();
    const intruso = generateSigningKeyPair();
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()], {
      signerPublicKey: publicKey,
      onError: () => {},
    });
    await runner.start();

    await backend.sendCommand(signCommand(intruso.privateKey, newTask(machine.id)));
    await settle();
    expect(await backend.listSessions()).toHaveLength(0);

    await runner.stop();
  });

  it("rechaza un comando alterado tras firmarlo", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const { publicKey, privateKey } = generateSigningKeyPair();
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()], {
      signerPublicKey: publicKey,
      onError: () => {},
    });
    await runner.start();

    const signed = signCommand(privateKey, newTask(machine.id));
    await backend.sendCommand({ ...signed, prompt: "rm -rf /" }); // manipulado
    await settle();
    expect(await backend.listSessions()).toHaveLength(0);

    await runner.stop();
  });

  it("rechaza un replay (mismo nonce, otro id de comando)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const { publicKey, privateKey } = generateSigningKeyPair();
    const runner = new AgentRunner(backend, machine.id, [new EchoAdapter()], {
      signerPublicKey: publicKey,
      onError: () => {},
    });
    await runner.start();

    const signed = signCommand(privateKey, newTask(machine.id));
    await backend.sendCommand(signed); // legítimo
    await waitFor(async () => (await backend.listSessions())[0]);

    await backend.sendCommand(signed); // replay: mismo nonce/firma, nuevo id
    await settle();
    expect(await backend.listSessions()).toHaveLength(1); // no creó otra sesión

    await runner.stop();
  });
});

describe("AgentRunner — cifrado e2e del diff", () => {
  const DIFF = "- contraseña_vieja\n+ contraseña_nueva";

  const findPermissionEvent = (backend: MemoryBackend, sessionId: string) =>
    waitFor(async () =>
      (await backend.listEvents(sessionId)).find((e) => e.type === "permission_required"),
    );

  it("cifra el diff hacia la app y esta lo descifra", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const app = generateBoxKeyPair();
    const runner = new AgentRunner(backend, machine.id, [new PermissionAdapter(DIFF)], {
      recipientBoxPublicKey: app.publicKey,
    });
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "claude-code",
      cwd: "/x",
      prompt: "cambia la contraseña",
    });

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    const event = await findPermissionEvent(backend, session.id);
    if (event.type !== "permission_required" || !event.diff) throw new Error("sin diff");

    expect(event.diff.type).toBe("encrypted"); // el backend solo ve opaco
    if (event.diff.type !== "encrypted") throw new Error("no cifrado");
    expect(event.diff.ciphertext).not.toContain("contraseña");
    expect(openSealed(event.diff, app.secretKey)).toBe(DIFF);

    await runner.stop();
  });

  it("con clave del runner, cifra Y autentica el diff (la app verifica el emisor)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const app = generateBoxKeyPair();
    const runnerBox = generateBoxKeyPair();
    const runner = new AgentRunner(backend, machine.id, [new PermissionAdapter(DIFF)], {
      recipientBoxPublicKey: app.publicKey,
      senderBoxSecretKey: runnerBox.secretKey,
    });
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "claude-code",
      cwd: "/x",
      prompt: "cambia la contraseña",
    });

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    const event = await findPermissionEvent(backend, session.id);
    if (event.type !== "permission_required" || event.diff?.type !== "encrypted") {
      throw new Error("sin diff cifrado");
    }
    expect(event.diff.alg).toBe("nacl-box");
    // La app abre y autentica contra la pública del runner.
    expect(boxOpen(event.diff, runnerBox.publicKey, app.secretKey)).toBe(DIFF);
    // Con otra pública (impostor) NO abre.
    expect(boxOpen(event.diff, generateBoxKeyPair().publicKey, app.secretKey)).toBeNull();

    await runner.stop();
  });

  it("sin clave de cifrado, el diff viaja inline (compatibilidad)", async () => {
    const backend = new MemoryBackend();
    const machine = await backend.registerMachine({ name: "PC" });
    const runner = new AgentRunner(backend, machine.id, [new PermissionAdapter(DIFF)]);
    await runner.start();

    await backend.sendCommand({
      type: "new_task",
      machineId: machine.id,
      agentType: "claude-code",
      cwd: "/x",
      prompt: "cambia la contraseña",
    });

    const session = await waitFor(async () => (await backend.listSessions())[0]);
    const event = await findPermissionEvent(backend, session.id);
    if (event.type !== "permission_required" || !event.diff) throw new Error("sin diff");
    expect(event.diff.type).toBe("inline");

    await runner.stop();
  });
});
