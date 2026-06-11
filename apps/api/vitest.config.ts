import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Redirects the LLM model cache to a per-process temp file so
    // tests never collide with the dev / prod cache. See
    // test/setup.ts for details.
    setupFiles: ["test/setup.ts"],
  },
});
