import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    dir: "./src",
    globals: true,
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.ts", "src/icon.ts"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
