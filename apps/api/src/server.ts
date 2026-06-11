// Minimal Express bootstrap. Real routes land in later ACs.
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { seed } from "./db/seed.js";

export function createApp(): express.Express {
  const app = express();
  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "cookbook-api",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

export function bootDb(): void {
  // Run migrations and seed on every boot; both are idempotent.
  runMigrations();
  seed();
}

// Boot only when run directly (tsx watch, node dist/server.js)
if (import.meta.url === `file://${process.argv[1]}`) {
  bootDb();
  const app = createApp();
  app.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://localhost:${config.PORT}`);
  });
}
