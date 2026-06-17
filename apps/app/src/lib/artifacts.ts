import { supabase } from "./supabase";

const BUCKET = "artifacts";

/** Resuelve la ref de Storage de un artifact a una URL firmada (previsualizar/descargar). */
export async function resolveArtifactUrl(
  ref: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(ref, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
