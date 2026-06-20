import { describe, expect, it } from "vitest";
import { encryptedPayloadSchema } from "./common.js";
import { boxOpen, boxSeal, generateBoxKeyPair, openSealed, sealToPublicKey } from "./encryption.js";

describe("cifrado e2e de payloads (sealed box)", () => {
  it("sella y abre con la clave del destinatario", () => {
    const app = generateBoxKeyPair();
    const sealed = sealToPublicKey("- linea vieja\n+ linea nueva", app.publicKey);
    expect(sealed.type).toBe("encrypted");
    expect(encryptedPayloadSchema.safeParse(sealed).success).toBe(true);
    expect(openSealed(sealed, app.secretKey)).toBe("- linea vieja\n+ linea nueva");
  });

  it("el ciphertext no contiene el texto claro", () => {
    const app = generateBoxKeyPair();
    const sealed = sealToPublicKey("SECRETO", app.publicKey);
    expect(sealed.ciphertext).not.toContain("SECRETO");
  });

  it("otra clave privada no puede abrirlo", () => {
    const app = generateBoxKeyPair();
    const otro = generateBoxKeyPair();
    const sealed = sealToPublicKey("hola", app.publicKey);
    expect(openSealed(sealed, otro.secretKey)).toBeNull();
  });

  it("un ciphertext manipulado no abre (autenticado)", () => {
    const app = generateBoxKeyPair();
    const sealed = sealToPublicKey("hola", app.publicKey);
    const tampered = { ...sealed, ciphertext: naclFlip(sealed.ciphertext) };
    expect(openSealed(tampered, app.secretKey)).toBeNull();
  });

  it("cada sellado usa una clave efímera y nonce distintos", () => {
    const app = generateBoxKeyPair();
    const a = sealToPublicKey("x", app.publicKey);
    const b = sealToPublicKey("x", app.publicKey);
    expect(a.epk).not.toBe(b.epk);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe("cifrado e2e autenticado (nacl-box)", () => {
  it("el receptor abre y autentica al remitente esperado", () => {
    const runner = generateBoxKeyPair();
    const app = generateBoxKeyPair();
    const sealed = boxSeal("diff secreto", app.publicKey, runner.secretKey);
    expect(sealed.alg).toBe("nacl-box");
    expect(encryptedPayloadSchema.safeParse(sealed).success).toBe(true);
    expect(boxOpen(sealed, runner.publicKey, app.secretKey)).toBe("diff secreto");
  });

  it("falla si el remitente declarado no es quien cifró (autenticidad)", () => {
    const runner = generateBoxKeyPair();
    const impostor = generateBoxKeyPair();
    const app = generateBoxKeyPair();
    const sealed = boxSeal("diff", app.publicKey, runner.secretKey);
    // Verificar contra la pública del impostor falla.
    expect(boxOpen(sealed, impostor.publicKey, app.secretKey)).toBeNull();
  });

  it("falla con la clave privada equivocada del receptor", () => {
    const runner = generateBoxKeyPair();
    const app = generateBoxKeyPair();
    const otro = generateBoxKeyPair();
    const sealed = boxSeal("diff", app.publicKey, runner.secretKey);
    expect(boxOpen(sealed, runner.publicKey, otro.secretKey)).toBeNull();
  });

  it("las funciones no cruzan algoritmos", () => {
    const runner = generateBoxKeyPair();
    const app = generateBoxKeyPair();
    const auth = boxSeal("x", app.publicKey, runner.secretKey);
    const anon = sealToPublicKey("x", app.publicKey);
    expect(openSealed(auth, app.secretKey)).toBeNull(); // openSealed solo abre anon
    expect(boxOpen(anon, runner.publicKey, app.secretKey)).toBeNull(); // boxOpen solo abre auth
  });
});

/** Voltea un carácter del base64 para simular manipulación. */
function naclFlip(b64: string): string {
  const first = b64[0] === "A" ? "B" : "A";
  return first + b64.slice(1);
}
