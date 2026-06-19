import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateBoxKeyPair } from "@batuta/protocol";

const STORAGE_KEY = "batuta.boxKey";

interface BoxKeyPair {
  publicKey: string;
  secretKey: string;
}

let cached: BoxKeyPair | null = null;

/**
 * Par de cifrado X25519 de este dispositivo (base64). La privada NUNCA sale del
 * dispositivo; su pública se registra al emparejar y el runner cifra los diffs
 * hacia ella. Es distinta de la clave de firma. Ver encryption.ts y SECURITY.md.
 */
export async function getOrCreateBoxKey(): Promise<BoxKeyPair> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    cached = JSON.parse(stored) as BoxKeyPair;
    return cached;
  }
  const pair = generateBoxKeyPair();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pair));
  cached = pair;
  return pair;
}

export async function getBoxPublicKey(): Promise<string> {
  return (await getOrCreateBoxKey()).publicKey;
}

export async function getBoxSecretKey(): Promise<string> {
  return (await getOrCreateBoxKey()).secretKey;
}
