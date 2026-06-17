import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolver los paquetes del workspace a su fuente: los tests corren contra
      // el código actual sin necesidad de compilar antes.
      "@batuta/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    // En etapas tempranas puede no haber tests; no queremos que falle por eso.
    passWithNoTests: true,
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
