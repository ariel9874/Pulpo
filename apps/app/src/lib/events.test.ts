import type { Event } from "@batuta/protocol";
import { describe, expect, it } from "vitest";
import { appendEvents } from "./events";

const ev = (id: string): Event => ({
  id,
  sessionId: "s",
  protocolVersion: 1,
  ts: "2026-01-01T00:00:00.000Z",
  type: "thought",
  text: "x",
});

describe("appendEvents", () => {
  it("añade un evento nuevo", () => {
    expect(appendEvents([], ev("a")).map((e) => e.id)).toEqual(["a"]);
  });

  it("ignora duplicados por id", () => {
    expect(appendEvents([ev("a")], ev("a"))).toHaveLength(1);
  });
});
