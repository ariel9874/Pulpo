import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateSigningKeyPair } from "@batuta/protocol";

const STORAGE_KEY = "batuta.signingKey";

interface SigningKeyPair {
  publicKey: string;
  privateKey: string;
}

let cached: SigningKeyPair | null = null;

/**
 * Par de firma de este dispositivo (Ed25519, base64). Se genera una vez y se
 * persiste; la privada NUNCA sale del dispositivo. Su pública se registra al
 * emparejar y el runner verifica los comandos contra ella. Ver signing.ts y
 * SECURITY.md.
 */
export async function getOrCreateSigningKey(): Promise<SigningKeyPair> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    cached = JSON.parse(stored) as SigningKeyPair;
    return cached;
  }
  const pair = generateSigningKeyPair();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pair));
  cached = pair;
  return pair;
}

export async function getSigningPublicKey(): Promise<string> {
  return (await getOrCreateSigningKey()).publicKey;
}
