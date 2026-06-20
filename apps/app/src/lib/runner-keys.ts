import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "batuta.runnerBoxPublic.";

/**
 * Clave pública de cifrado del runner de una máquina, anclada al emparejar. La
 * app la usa para AUTENTICAR los diffs cifrados (e2e mutuo) — confía en esta copia
 * local, no en lo que diga la BD después. Ver encryption.ts y SECURITY.md.
 */
export async function setRunnerBoxPublic(machineId: string, publicKey: string): Promise<void> {
  await AsyncStorage.setItem(PREFIX + machineId, publicKey);
}

export async function getRunnerBoxPublic(machineId: string): Promise<string | null> {
  return AsyncStorage.getItem(PREFIX + machineId);
}
