import type { Session } from "@pulpo/protocol";

/** Inserta o reemplaza una sesión por id, dejando la lista ordenada (más nueva primero). */
export function upsertSession(sessions: Session[], incoming: Session): Session[] {
  const others = sessions.filter((s) => s.id !== incoming.id);
  return [incoming, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
