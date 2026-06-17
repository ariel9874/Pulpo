import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // En la Etapa 1 puede no haber tests todavía; no queremos que falle por eso.
    passWithNoTests: true,
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
