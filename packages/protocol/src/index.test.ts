import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./index.js";

describe("@batuta/protocol", () => {
  it("expone una versión de protocolo estable", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
