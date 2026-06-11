import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

describe("api health", () => {
  it("returns ok on /api/health", async () => {
    const app = createApp();
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe("cookbook-api");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
