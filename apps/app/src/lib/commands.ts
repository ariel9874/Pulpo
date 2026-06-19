import { signCommand, type SendCommandInput } from "@batuta/protocol";
import { backend } from "./backend";
import { getOrCreateSigningKey } from "./signing-key";

/**
 * Envía un comando FIRMADO con la clave de este dispositivo. El runner (si se
 * emparejó con firma) solo ejecuta comandos con firma válida. Todas las acciones
 * de la app (nueva tarea, mensaje, aprobar/rechazar, cancelar) pasan por aquí.
 */
export async function sendSignedCommand(input: SendCommandInput): Promise<void> {
  const { privateKey } = await getOrCreateSigningKey();
  await backend.sendCommand(signCommand(privateKey, input));
}
