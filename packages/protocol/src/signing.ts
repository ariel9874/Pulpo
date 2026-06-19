import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

/**
 * Firma de comandos (integridad ante cuenta/backend comprometidos).
 *
 * La app firma cada comando con una clave privada Ed25519 que vive SOLO en el
 * dispositivo; el runner verifica con la pública que recibió al emparejar. Como
 * el backend nunca tiene la privada, aunque comprometan la cuenta no pueden
 * forjar un comando que el runner acepte (recuerda: un comando ejecuta código en
 * tu PC). Ver SECURITY.md.
 */

/** Campos que la app añade al firmar (viajan dentro del comando). */
export interface CommandSignatureFields {
  /** Aleatorio por comando: ata la firma a este comando y permite anti-replay. */
  nonce: string;
  /** Cuándo lo firmó la app (ISO-8601); permite descartar comandos rancios. */
  issuedAt: string;
  /** Firma Ed25519 (base64) del contenido canónico. */
  signature: string;
}

// Campos asignados por el backend (o la propia firma): NO entran en lo firmado,
// porque la app no los conoce al firmar y el backend los añade después.
const UNSIGNED_KEYS = new Set(["id", "ts", "protocolVersion", "signature"]);

/**
 * Representación canónica y determinista del contenido firmable de un comando:
 * pares [clave, valor] ordenados por clave, omitiendo los campos no firmados y
 * los nulos/indefinidos. App y runner derivan exactamente lo mismo del comando.
 */
export function canonicalCommandContent(command: Record<string, unknown>): string {
  const entries = Object.entries(command)
    .filter(([k, v]) => !UNSIGNED_KEYS.has(k) && v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/** Genera un par de claves de firma (base64). La privada nunca sale del dispositivo. */
export function generateSigningKeyPair(): { publicKey: string; privateKey: string } {
  const pair = nacl.sign.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(pair.publicKey),
    privateKey: naclUtil.encodeBase64(pair.secretKey),
  };
}

/**
 * Firma el contenido de un comando: añade `nonce`, `issuedAt` y `signature`.
 * Devuelve el comando listo para enviar.
 */
export function signCommand<T extends Record<string, unknown>>(
  privateKey: string,
  input: T,
): T & CommandSignatureFields {
  const nonce = naclUtil.encodeBase64(nacl.randomBytes(16));
  const issuedAt = new Date().toISOString();
  const signed = { ...input, nonce, issuedAt };
  const message = naclUtil.decodeUTF8(canonicalCommandContent(signed));
  const signature = naclUtil.encodeBase64(
    nacl.sign.detached(message, naclUtil.decodeBase64(privateKey)),
  );
  return { ...signed, signature };
}

/** Verifica la firma de un comando contra una clave pública (base64). */
export function verifyCommandSignature(
  publicKey: string,
  command: Record<string, unknown>,
): boolean {
  const signature = command["signature"];
  if (typeof signature !== "string" || signature.length === 0) return false;
  try {
    const message = naclUtil.decodeUTF8(canonicalCommandContent(command));
    return nacl.sign.detached.verify(
      message,
      naclUtil.decodeBase64(signature),
      naclUtil.decodeBase64(publicKey),
    );
  } catch {
    return false;
  }
}
