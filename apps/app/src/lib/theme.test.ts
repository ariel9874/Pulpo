import { describe, expect, it } from "vitest";
import { nextPreference, paletteFor, resolveScheme } from "./theme";

describe("resolveScheme", () => {
  it("'system' sigue al sistema", () => {
    expect(resolveScheme("dark", "system")).toBe("dark");
    expect(resolveScheme("light", "system")).toBe("light");
  });

  it("'system' cae a light si el sistema no reporta nada", () => {
    expect(resolveScheme(null, "system")).toBe("light");
    expect(resolveScheme(undefined, "system")).toBe("light");
  });

  it("una preferencia explícita gana al sistema", () => {
    expect(resolveScheme("light", "dark")).toBe("dark");
    expect(resolveScheme("dark", "light")).toBe("light");
  });
});

describe("nextPreference", () => {
  it("cicla system → light → dark → system", () => {
    expect(nextPreference("system")).toBe("light");
    expect(nextPreference("light")).toBe("dark");
    expect(nextPreference("dark")).toBe("system");
  });
});

describe("paletteFor", () => {
  it("devuelve paletas distintas para claro y oscuro", () => {
    expect(paletteFor("light").bg).not.toBe(paletteFor("dark").bg);
  });
});
