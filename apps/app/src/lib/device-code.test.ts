import { describe, expect, it } from "vitest";
import { normalizeDeviceCode } from "./device-code";

describe("normalizeDeviceCode", () => {
  it("pasa a mayúsculas", () => {
    expect(normalizeDeviceCode("a1b2c3d4")).toBe("A1B2C3D4");
  });

  it("quita espacios y guiones", () => {
    expect(normalizeDeviceCode("A1B2 C3D4")).toBe("A1B2C3D4");
    expect(normalizeDeviceCode("a1b2-c3d4")).toBe("A1B2C3D4");
    expect(normalizeDeviceCode("  a1 b2 ")).toBe("A1B2");
  });

  it("vacío si no hay caracteres alfanuméricos", () => {
    expect(normalizeDeviceCode("  --  ")).toBe("");
  });
});
