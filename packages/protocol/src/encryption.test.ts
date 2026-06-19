import { describe, expect, it } from "vitest";
import { encryptedPayloadSchema } from "./common.js";
import { generateBoxKeyPair, openSealed, sealToPublicKey } from "./encryption.js";

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

/** Voltea un carácter del base64 para simular manipulación. */
function naclFlip(b64: string): string {
  const first = b64[0] === "A" ? "B" : "A";
  return first + b64.slice(1);
}
