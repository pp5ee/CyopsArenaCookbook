// HTTP routes for votes:
//   GET /api/votes           → { current, history, lastDelta, observedAt }
//   GET /api/votes/stream    → SSE stream of 'vote' + 'credits' events
//
// The SSE endpoint also emits a `ping` every 25 s to keep idle proxies
// from closing the connection. A client may close the connection at any
// time; we must remove the listener to keep the listener count honest.

import { Router, type Request, type Response } from "express";
import { broadcaster, type SseEvent } from "../sse/broadcaster.js";
import { votesSummary } from "../services/votes.js";

const PING_MS = 25_000;

function writeSse(res: Response, event: SseEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export const votesRouter = Router();

votesRouter.get("/", (_req, res) => {
  const summary = votesSummary();
  res.json(summary);
});

votesRouter.get("/stream", (req: Request, res: Response) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders?.();

  // Send a comment line to establish the stream; many browsers won't
  // render the EventSource as "open" until at least one byte is written.
  res.write(`: connected ${new Date().toISOString()}\n\n`);

  // Replay the current summary so late subscribers see the same view
  // as a fresh GET /api/votes.
  const summary = votesSummary();
  writeSse(res, {
    type: "vote",
    delta: 0,
    current: summary.current,
    observedAt: summary.observedAt,
  });

  const unsubscribe = broadcaster.subscribe((event) => {
    try {
      writeSse(res, event);
    } catch {
      // best-effort
    }
  });

  const ping = setInterval(() => {
    try {
      writeSse(res, { type: "ping", ts: Date.now() });
    } catch {
      // best-effort
    }
  }, PING_MS);

  const cleanup = (): void => {
    clearInterval(ping);
    unsubscribe();
    res.end();
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("close", cleanup);
});
