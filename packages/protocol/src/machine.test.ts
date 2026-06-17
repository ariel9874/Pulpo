import { describe, expect, it } from "vitest";
import { isMachineOnline } from "./machine.js";

const now = Date.parse("2026-06-17T10:00:00.000Z");
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe("isMachineOnline", () => {
  it("online con heartbeat reciente → true", () => {
    expect(isMachineOnline({ status: "online", lastSeen: iso(1_000) }, { nowMs: now })).toBe(true);
  });

  it("status offline → false aunque el heartbeat sea reciente", () => {
    expect(isMachineOnline({ status: "offline", lastSeen: iso(1_000) }, { nowMs: now })).toBe(
      false,
    );
  });

  it("online pero heartbeat obsoleto (runner muerto sin apagado limpio) → false", () => {
    expect(
      isMachineOnline(
        { status: "online", lastSeen: iso(60_000) },
        { nowMs: now, staleAfterMs: 30_000 },
      ),
    ).toBe(false);
  });
});
