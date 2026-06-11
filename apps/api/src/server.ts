// Express bootstrap. Wires CORS, JSON, the routers, the health route,
// and — when run directly — boots the DB and starts the vote poller.
// The exported `createApp()` is pure: it does not touch the DB or the
// network, so vitest can use it as-is.
import express, { type Express } from "express";
import cors from "cors";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { seed } from "./db/seed.js";
import { votesRouter } from "./routes/votes.js";
import { creditsRouter } from "./routes/credits.js";
import { chatRouter } from "./routes/chat.js";
import { promptRouter } from "./routes/prompt.js";
import { startVotePoller, stopVotePoller } from "./jobs/votePoller.js";

export function createApp(): Express {
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

  app.use("/api/votes", votesRouter);
  app.use("/api/credits", creditsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/prompt", promptRouter);

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
  startVotePoller();
  const server = app.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://localhost:${config.PORT}`);
  });
  const shutdown = (sig: string): void => {
    // eslint-disable-next-line no-console
    console.log(`[api] ${sig} received; shutting down`);
    stopVotePoller();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
