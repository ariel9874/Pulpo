import type { DevicePlatform } from "@batuta/protocol";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { backend } from "./backend";

/** Topic de ntfy.sh del usuario (push dev). Coincide con el del trigger en Postgres. */
export function ntfyTopicFor(userId: string): string {
  return `batuta-${userId.replace(/-/g, "")}`;
}

function currentPlatform(): DevicePlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

/**
 * Pide permiso de notificaciones, obtiene el token de push y lo registra en el
 * backend. Best-effort: si el dispositivo/entorno no da token (p. ej. web sin
 * configurar, o sin proyecto EAS), no falla — solo avisa.
 */
export async function registerForPush(): Promise<void> {
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    await backend.registerDeviceToken({ token, platform: currentPlatform() });
  } catch (err) {
    console.warn("push: no se pudo registrar el token de notificaciones", err);
  }
}
