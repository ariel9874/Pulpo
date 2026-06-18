import type { Artifact, ArtifactKind, Event } from "@batuta/protocol";

export interface GalleryItem {
  /** Id del evento que trajo el artifact (clave estable en listas). */
  id: string;
  artifact: Artifact;
  ts: string;
}

/** Filtro de la galería: un tipo concreto o "todos". */
export type KindFilter = "all" | ArtifactKind;

/** Extrae los recursos (`artifact`) de la actividad de una sesión, más nuevos primero. */
export function collectArtifacts(events: Event[]): GalleryItem[] {
  return events
    .filter((e): e is Extract<Event, { type: "artifact" }> => e.type === "artifact")
    .map((e) => ({ id: e.id, artifact: e.artifact, ts: e.ts }))
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

export function filterByKind(items: GalleryItem[], kind: KindFilter): GalleryItem[] {
  return kind === "all" ? items : items.filter((i) => i.artifact.kind === kind);
}

/** Cuántos recursos hay de cada tipo (para mostrar los filtros con su conteo). */
export function kindCounts(items: GalleryItem[]): Record<ArtifactKind, number> {
  const counts: Record<ArtifactKind, number> = { text: 0, image: 0, audio: 0, video: 0, file: 0 };
  for (const item of items) counts[item.artifact.kind] += 1;
  return counts;
}

/** Tamaño legible (B, KB, MB, GB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[i]}`;
}

const ICON: Record<ArtifactKind, string> = {
  text: "📄",
  image: "🖼️",
  audio: "🎵",
  video: "🎬",
  file: "📦",
};

/** Emoji representativo del tipo de recurso (para tarjetas sin miniatura). */
export function kindIcon(kind: ArtifactKind): string {
  return ICON[kind];
}

export function artifactLabel(artifact: Artifact): string {
  return `${artifact.name} · ${formatBytes(artifact.size)}`;
}
