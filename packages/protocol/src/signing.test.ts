import { describe, expect, it } from "vitest";
import {
  canonicalCommandContent,
  generateSigningKeyPair,
  signCommand,
  verifyCommandSignature,
} from "./signing.js";

const newTaskInput = {
  type: "new_task" as const,
  machineId: "11111111-1111-4111-8111-111111111111",
  agentType: "claude-code" as const,
  cwd: "/proyecto",
  prompt: "arregla el login",
};

describe("canonicalCommandContent", () => {
  it("es estable ante el orden de las claves", () => {
    expect(canonicalCommandContent({ a: 1, b: 2 })).toBe(canonicalCommandContent({ b: 2, a: 1 }));
  });

  it("ignora id/ts/protocolVersion/signature y nulos", () => {
    const base = { type: "cancel", sessionId: "s", nonce: "n", issuedAt: "t" };
    const withMeta = { ...base, id: "x", ts: "y", protocolVersion: 1, signature: "z", extra: null };
    expect(canonicalCommandContent(base)).toBe(canonicalCommandContent(withMeta));
  });
});

describe("firma y verificación de comandos", () => {
  it("un comando firmado verifica con la clave pública correcta", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const signed = signCommand(privateKey, newTaskInput);
    expect(signed.signature).toBeTruthy();
    expect(signed.nonce).toBeTruthy();
    expect(signed.issuedAt).toBeTruthy();
    expect(verifyCommandSignature(publicKey, signed)).toBe(true);
  });

  it("sigue verificando tras añadir id/ts/protocolVersion (lo que pone el backend)", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const signed = signCommand(privateKey, newTaskInput);
    const asStored = { ...signed, id: "abc", ts: "2026-06-18T00:00:00.000Z", protocolVersion: 1 };
    expect(verifyCommandSignature(publicKey, asStored)).toBe(true);
  });

  it("falla si manipulan un campo (p. ej. el prompt)", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const signed = signCommand(privateKey, newTaskInput);
    expect(verifyCommandSignature(publicKey, { ...signed, prompt: "rm -rf /" })).toBe(false);
  });

  it("falla si manipulan la máquina destino", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const signed = signCommand(privateKey, newTaskInput);
    expect(verifyCommandSignature(publicKey, { ...signed, machineId: "otra" })).toBe(false);
  });

  it("falla con otra clave pública", () => {
    const { privateKey } = generateSigningKeyPair();
    const otra = generateSigningKeyPair();
    const signed = signCommand(privateKey, newTaskInput);
    expect(verifyCommandSignature(otra.publicKey, signed)).toBe(false);
  });

  it("un comando sin firma no verifica", () => {
    const { publicKey } = generateSigningKeyPair();
    expect(verifyCommandSignature(publicKey, newTaskInput)).toBe(false);
  });

  it("firma inválida (base64 basura) no rompe, devuelve false", () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const signed = signCommand(privateKey, newTaskInput);
    expect(verifyCommandSignature(publicKey, { ...signed, signature: "no-es-base64-***" })).toBe(
      false,
    );
  });

  it("cada firma usa un nonce distinto (anti-replay)", () => {
    const { privateKey } = generateSigningKeyPair();
    const a = signCommand(privateKey, newTaskInput);
    const b = signCommand(privateKey, newTaskInput);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.signature).not.toBe(b.signature);
  });
});
