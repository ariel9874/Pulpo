import { isMachineOnline, type Machine, type Session } from "@pulpo/protocol";

export interface MachineGroup {
  /** La máquina del grupo, o `null` para sesiones cuya máquina ya no está en la lista. */
  machine: Machine | null;
  online: boolean;
  sessions: Session[];
}

/**
 * Agrupa sesiones por PC para gobernar varias máquinas/agentes desde una sola
 * pantalla. Incluye máquinas SIN sesiones (para ver tus PCs emparejadas) y, al
 * final, un grupo "desconocida" con las sesiones cuya máquina no aparece.
 *
 * Orden: máquinas online primero, luego por nombre; dentro de cada grupo, las
 * sesiones más nuevas primero. El grupo de máquina desconocida va al final.
 */
export function groupByMachine(
  machines: Machine[],
  sessions: Session[],
  nowMs?: number,
): MachineGroup[] {
  const opts = nowMs === undefined ? undefined : { nowMs };
  const byMachine = new Map<string, Session[]>();
  for (const session of sessions) {
    const list = byMachine.get(session.machineId) ?? [];
    list.push(session);
    byMachine.set(session.machineId, list);
  }

  const sortSessions = (list: Session[]): Session[] =>
    [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const groups: MachineGroup[] = machines.map((machine) => ({
    machine,
    online: isMachineOnline(machine, opts),
    sessions: sortSessions(byMachine.get(machine.id) ?? []),
  }));

  groups.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.machine?.name ?? "").localeCompare(b.machine?.name ?? "");
  });

  // Sesiones cuya máquina no está en la lista (p. ej. borrada): grupo final.
  const known = new Set(machines.map((m) => m.id));
  const orphans = sessions.filter((s) => !known.has(s.machineId));
  if (orphans.length > 0) {
    groups.push({ machine: null, online: false, sessions: sortSessions(orphans) });
  }

  return groups;
}
