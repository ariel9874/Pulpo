import type { Session } from "@pulpo/protocol";
import { describe, expect, it } from "vitest";
import { filterSessions } from "./search";

const make = (id: string, title: string, agentType: Session["agentType"] = "echo"): Session => ({
  id,
  machineId: "m",
  agentType,
  title,
  status: "running",
  cwd: "/x",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("filterSessions", () => {
  const sessions = [
    make("a", "Refactor de login", "claude-code"),
    make("b", "Generar imágenes"),
    make("c", "Arreglar bug"),
  ];

  it("una consulta vacía devuelve todo", () => {
    expect(filterSessions(sessions, "")).toHaveLength(3);
    expect(filterSessions(sessions, "   ")).toHaveLength(3);
  });

  it("filtra por título, sin distinguir mayúsculas", () => {
    expect(filterSessions(sessions, "REFACTOR").map((s) => s.id)).toEqual(["a"]);
  });

  it("ignora acentos en ambos sentidos", () => {
    expect(filterSessions(sessions, "imagenes").map((s) => s.id)).toEqual(["b"]);
    expect(filterSessions(sessions, "imágenes").map((s) => s.id)).toEqual(["b"]);
  });

  it("también busca por agente", () => {
    expect(filterSessions(sessions, "claude").map((s) => s.id)).toEqual(["a"]);
  });

  it("devuelve vacío si nada coincide", () => {
    expect(filterSessions(sessions, "zzz")).toHaveLength(0);
  });
});
