import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    // Default environment is Node. Tests that need a DOM opt in with the
    // `// @vitest-environment jsdom` directive at the top of the file —
    // see e.g. tests/unit/generator/svgBuilder.test.ts. This is the
    // Vitest 4+ replacement for the deprecated `environmentMatchGlobs`.
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "tests/integration/**/*.test.ts", "tests/integration/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/types.ts", "src/ifc/ifc-worker.ts"],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});
