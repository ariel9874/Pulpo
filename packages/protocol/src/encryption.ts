import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import type { EncryptedPayload } from "./common.js";

/**
 * Cifrado extremo-a-extremo de payloads sensibles (diffs).
 *
 * El diff solo viaja runner → app, así que usamos un "sealed box" (estilo
 * libsodium) contra la clave pública de cifrado de la app, registrada al
 * emparejar. El runner cifra con un par EFÍMERO por mensaje (remitente anónimo);
 * solo la app, con su clave privada, descifra. El backend nunca ve el texto
 * claro. Da confidencialidad frente al BaaS; ver SECURITY.md para el alcance.
 *
 * Clave de cifrado (X25519) ≠ clave de firma (Ed25519): son cosas distintas.
 */

/** Genera un par de claves de cifrado X25519 (base64). La privada no sale del dispositivo. */
export function generateBoxKeyPair(): { publicKey: string; secretKey: string } {
  const pair = nacl.box.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(pair.publicKey),
    secretKey: naclUtil.encodeBase64(pair.secretKey),
  };
}

/** Sella un texto hacia la clave pública del destinatario (remitente efímero/anónimo). */
export function sealToPublicKey(plaintext: string, recipientPublicKey: string): EncryptedPayload {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const boxed = nacl.box(
    naclUtil.decodeUTF8(plaintext),
    nonce,
    naclUtil.decodeBase64(recipientPublicKey),
    ephemeral.secretKey,
  );
  return {
    type: "encrypted",
    alg: "nacl-box-anon",
    epk: naclUtil.encodeBase64(ephemeral.publicKey),
    nonce: naclUtil.encodeBase64(nonce),
    ciphertext: naclUtil.encodeBase64(boxed),
  };
}

/** Abre un payload sellado con la clave privada del destinatario, o `null` si falla. */
export function openSealed(payload: EncryptedPayload, recipientSecretKey: string): string | null {
  try {
    const opened = nacl.box.open(
      naclUtil.decodeBase64(payload.ciphertext),
      naclUtil.decodeBase64(payload.nonce),
      naclUtil.decodeBase64(payload.epk),
      naclUtil.decodeBase64(recipientSecretKey),
    );
    return opened ? naclUtil.encodeUTF8(opened) : null;
  } catch {
    return null;
  }
}
