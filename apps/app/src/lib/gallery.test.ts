import type { Artifact, Event } from "@pulpo/protocol";
import { describe, expect, it } from "vitest";
import { collectArtifacts, filterByKind, formatBytes, kindCounts } from "./gallery";

const SID = "11111111-1111-4111-8111-111111111111";

const artifact = (name: string, kind: Artifact["kind"]): Artifact => ({
  kind,
  mime: "application/octet-stream",
  name,
  size: 10,
  ref: `${SID}/${name}`,
});

const artifactEvent = (id: string, ts: string, a: Artifact): Event => ({
  id,
  sessionId: SID,
  protocolVersion: 1,
  type: "artifact",
  ts,
  artifact: a,
});

const messageEvent = (id: string, ts: string): Event => ({
  id,
  sessionId: SID,
  protocolVersion: 1,
  type: "message",
  ts,
  role: "agent",
  text: "hola",
});

describe("collectArtifacts", () => {
  it("solo recoge eventos artifact, más nuevos primero", () => {
    const events = [
      artifactEvent("a", "2026-01-01T00:00:00.000Z", artifact("uno.png", "image")),
      messageEvent("m", "2026-01-02T00:00:00.000Z"),
      artifactEvent("b", "2026-01-03T00:00:00.000Z", artifact("dos.txt", "text")),
    ];
    const items = collectArtifacts(events);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(items.every((i) => i.artifact)).toBe(true);
  });
});

describe("filterByKind", () => {
  const items = collectArtifacts([
    artifactEvent("a", "2026-01-01T00:00:00.000Z", artifact("uno.png", "image")),
    artifactEvent("b", "2026-01-02T00:00:00.000Z", artifact("dos.txt", "text")),
    artifactEvent("c", "2026-01-03T00:00:00.000Z", artifact("tres.png", "image")),
  ]);

  it("'all' devuelve todo", () => {
    expect(filterByKind(items, "all")).toHaveLength(3);
  });

  it("filtra por tipo", () => {
    expect(filterByKind(items, "image").map((i) => i.id)).toEqual(["c", "a"]);
    expect(filterByKind(items, "text").map((i) => i.id)).toEqual(["b"]);
    expect(filterByKind(items, "audio")).toHaveLength(0);
  });
});

describe("kindCounts", () => {
  it("cuenta por tipo", () => {
    const items = collectArtifacts([
      artifactEvent("a", "2026-01-01T00:00:00.000Z", artifact("uno.png", "image")),
      artifactEvent("b", "2026-01-02T00:00:00.000Z", artifact("dos.png", "image")),
      artifactEvent("c", "2026-01-03T00:00:00.000Z", artifact("tres.mp3", "audio")),
    ]);
    expect(kindCounts(items)).toEqual({ text: 0, image: 2, audio: 1, video: 0, file: 0 });
  });
});

describe("formatBytes", () => {
  it("formatea tamaños", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});
