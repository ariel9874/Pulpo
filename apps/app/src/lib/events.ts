import type { Event } from "@batuta/protocol";

/** Añade un evento a la lista, ignorando duplicados por id (orden de llegada). */
export function appendEvents(events: Event[], incoming: Event): Event[] {
  if (events.some((e) => e.id === incoming.id)) return events;
  return [...events, incoming];
}
