// Votes service: fetch the live arena JSON, normalize the vote count,
// record a snapshot, and (on a positive delta) write a credit-ledger row
// for the +100 grant.

import { config } from "../config.js";
import { getDb } from "../db/connection.js";
import { broadcaster } from "../sse/broadcaster.js";
import { recordGrant } from "./credits.js";

/** Read a numeric vote count from any of the accepted JSON shapes. */
export function extractVotes(payload: unknown): number | null {
  if (payload === null || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  const direct = obj["votes"] ?? obj["vote_count"] ?? obj["total_votes"];
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  if (typeof direct === "string" && /^\d+$/.test(direct)) {
    return Number.parseInt(direct, 10);
  }

  const data = obj["data"];
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>)["votes"];
    if (typeof nested === "number" && Number.isFinite(nested)) return nested;
    if (typeof nested === "string" && /^\d+$/.test(nested)) {
      return Number.parseInt(nested, 10);
    }
  }

  return null;
}

export interface PollOutcome {
  current: number;
  delta: number;
  observedAt: string;
  skipped: boolean;
}

/** Fetch the live arena JSON and return its vote count, or null on error. */
export async function fetchLiveVotes(
  url: string = config.SUBMISSIONS_URL,
): Promise<{ votes: number; raw: string } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) {
      return null;
    }
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const votes = extractVotes(parsed);
    if (votes === null) return null;
    return { votes, raw };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Persist the polled vote count, grant credits for any positive delta,
 * and broadcast a 'vote' SSE event.
 *
 * The ledger invariant: the latest row's `balance` is the current pool.
 * A positive vote delta calls into `recordGrant()` from the credits
 * service, which INSERTs a new row with `delta = +100 * delta_votes`
 * and broadcasts a `credits` SSE event on the first edge-crossing of
 * the 20-credit threshold. A non-positive delta records the snapshot
 * but writes no ledger row.
 */
export function recordPoll(
  votes: number,
  rawJson: string,
  now: Date = new Date(),
  db = getDb(),
): PollOutcome {
  const nowIso = now.toISOString().replace("T", " ").slice(0, 19);

  const last = db
    .prepare(
      `SELECT votes FROM vote_snapshot ORDER BY id DESC LIMIT 1`,
    )
    .get() as { votes: number } | undefined;

  const prev = last?.votes ?? null;
  const delta = prev === null ? 0 : votes - prev;

  // Always record the snapshot — even when votes are unchanged, the
  // observed_at is a useful heartbeat.
  db.prepare(
    `INSERT INTO vote_snapshot (votes, raw_json, observed_at)
     VALUES (?, ?, ?)`,
  ).run(votes, rawJson, nowIso);

  const outcome: PollOutcome = {
    current: votes,
    delta,
    observedAt: nowIso,
    skipped: prev === null,
  };

  if (delta > 0) {
    const grant = config.CREDIT_PER_VOTE * delta;
    recordGrant(grant, "vote", `votes+${delta}`, db);
  }

  // Broadcast on every poll (not just deltas) so the ticker UI knows
  // the server is alive. The 'skipped' flag tells the UI not to show a
  // toast on a no-op tick.
  broadcaster.publish({
    type: "vote",
    delta: outcome.delta,
    current: outcome.current,
    observedAt: outcome.observedAt,
  });

  return outcome;
}

/** Read the public votes summary used by GET /api/votes. */
export function votesSummary(db = getDb()): {
  current: number;
  history: { votes: number; observedAt: string }[];
  lastDelta: number;
  observedAt: string;
} {
  const last = db
    .prepare(
      `SELECT votes, observed_at FROM vote_snapshot
       ORDER BY id DESC LIMIT 1`,
    )
    .get() as { votes: number; observed_at: string } | undefined;

  const history = (
    db
      .prepare(
        `SELECT votes, observed_at AS observedAt
         FROM vote_snapshot
         ORDER BY id DESC LIMIT 50`,
      )
      .all() as { votes: number; observedAt: string }[]
  ).reverse();

  if (!last) {
    return {
      current: 0,
      history: [],
      lastDelta: 0,
      observedAt: new Date(0).toISOString().replace("T", " ").slice(0, 19),
    };
  }

  // lastDelta = current - previous; if only one snapshot exists, 0.
  const previous = history.length > 1 ? history[history.length - 2] : undefined;
  const lastDelta = previous ? last.votes - previous.votes : 0;

  return {
    current: last.votes,
    history,
    lastDelta,
    observedAt: last.observed_at,
  };
}
