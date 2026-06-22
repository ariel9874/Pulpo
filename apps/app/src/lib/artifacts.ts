import type { Artifact } from "@pulpo/protocol";
import { Linking } from "react-native";
import { supabase } from "./supabase";

const BUCKET = "artifacts";

/**
 * Resuelve la ref de Storage de un artifact a una URL firmada (previsualizar o
 * descargar). Con `download`, la URL fuerza descarga (Content-Disposition) con
 * ese nombre de archivo — así funciona igual en web y en móvil.
 */
export async function resolveArtifactUrl(
  ref: string,
  expiresInSeconds = 3600,
  options?: { download?: string | boolean },
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(ref, expiresInSeconds, options);
  if (error) return null;
  return data.signedUrl;
}

/** Descarga un recurso (abre su URL firmada con descarga forzada). */
export async function downloadArtifact(artifact: Artifact): Promise<boolean> {
  const url = await resolveArtifactUrl(artifact.ref, 3600, { download: artifact.name });
  if (!url) return false;
  await Linking.openURL(url);
  return true;
}

/** Descarga varios recursos de una sola vez. Best-effort: cuenta éxitos y fallos. */
export async function downloadAll(artifacts: Artifact[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const artifact of artifacts) {
    if (await downloadArtifact(artifact)) ok += 1;
    else failed += 1;
  }
  return { ok, failed };
}
