/**
 * Normaliza el código que teclea el usuario: quita espacios/guiones y pasa a
 * mayúsculas (el código del runner son 8 hex en mayúsculas). Así da igual cómo
 * lo copie. Módulo puro (sin dependencias de red/RN) para poder testearlo.
 */
export function normalizeDeviceCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}
