import { defineConfig } from "vitest/config";

// AC-10 configuration:
//  - include: every `*.test.ts` in `test/`
//  - environment: node (we hit sqlite + express in-process)
//  - setupFiles: redirects the LLM model-selection cache to a
//    per-process temp file (see test/setup.ts)
//  - coverage: v8 provider, reports to `coverage/` (gitignored),
//    emits text / html / json / clover so CI can pick whichever
//    it prefers.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "json", "json-summary", "clover"],
      reportsDirectory: "./coverage",
      // Per-file minimums are intentionally low — the AC-10 plan
      // just requires the report to exist and `pnpm test` to
      // exit 0. Tighter thresholds can be added once the suite
      // stabilises.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
      include: ["src/**/*.ts"],
      exclude: [
        "src/server.ts", // main bootstrap is exercised via the routes; the createApp() boot path is integration territory
        "src/**/*.d.ts",
      ],
    },
  },
});
