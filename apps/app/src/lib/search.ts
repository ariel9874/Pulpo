import type { Session } from "@pulpo/protocol";

/** Normaliza para buscar sin distinguir mayúsculas ni acentos (quita diacríticos). */
function norm(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase().normalize("NFD")) {
    const code = ch.codePointAt(0);
    // Rango de marcas diacríticas combinantes: U+0300–U+036F.
    if (code !== undefined && code >= 0x300 && code <= 0x36f) continue;
    out += ch;
  }
  return out;
}

/**
 * Filtra el historial de sesiones por texto (en título y agente). Una consulta
 * vacía devuelve todo. Insensible a mayúsculas y acentos.
 */
export function filterSessions(sessions: Session[], query: string): Session[] {
  const q = norm(query.trim());
  if (!q) return sessions;
  return sessions.filter((s) => norm(s.title).includes(q) || norm(s.agentType).includes(q));
}
