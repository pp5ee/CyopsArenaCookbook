import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDb, getDb, openDb } from "../src/db/connection.js";
import {
  extractVotes,
  recordPoll,
  fetchLiveVotes,
  votesSummary,
} from "../src/services/votes.js";
import { broadcaster, type SseEvent } from "../src/sse/broadcaster.js";
import {
  startVotePoller,
  stopVotePoller,
  pollerState,
} from "../src/jobs/votePoller.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

describe("votes service", () => {
  let workDir: string;
  let dbFile: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "cookbook-votes-"));
    dbFile = join(workDir, "votes.sqlite");
    setDb(openDb(dbFile));
    runMigrations();
    seed();
  });

  afterEach(() => {
    stopVotePoller();
    setDb(null);
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("extractVotes normalizer", () => {
    it("accepts { votes: number }", () => {
      expect(extractVotes({ votes: 42 })).toBe(42);
    });
    it("accepts { vote_count: number }", () => {
      expect(extractVotes({ vote_count: 7 })).toBe(7);
    });
    it("accepts { total_votes: number }", () => {
      expect(extractVotes({ total_votes: 11 })).toBe(11);
    });
    it("accepts { data: { votes: number } }", () => {
      expect(extractVotes({ data: { votes: 99 } })).toBe(99);
    });
    it("accepts numeric strings", () => {
      expect(extractVotes({ vote_count: "12" })).toBe(12);
    });
    it("returns null when nothing parses", () => {
      expect(extractVotes({ foo: "bar" })).toBeNull();
      expect(extractVotes(null)).toBeNull();
      expect(extractVotes("nope")).toBeNull();
    });
  });

  describe("recordPoll", () => {
    it("inserts a vote_snapshot row and reports delta=0 for the first poll", () => {
      const out = recordPoll(5, '{"votes":5}');
      expect(out.current).toBe(5);
      expect(out.delta).toBe(0);
      expect(out.skipped).toBe(true);
      const rows = getDb()
        .prepare("SELECT votes FROM vote_snapshot")
        .all() as { votes: number }[];
      expect(rows).toEqual([{ votes: 5 }]);
    });

    it("writes a credit_ledger row on positive delta with +100*delta_votes", () => {
      recordPoll(5, '{"votes":5}');
      const startBal = (
        getDb()
          .prepare(
            "SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1",
          )
          .get() as { balance: number }
      ).balance;

      const out = recordPoll(8, '{"votes":8}'); // +3 votes = +300 credits
      expect(out.delta).toBe(3);
      expect(out.skipped).toBe(false);

      const ledger = getDb()
        .prepare(
          "SELECT balance, delta, reason, ref FROM credit_ledger ORDER BY id ASC",
        )
        .all() as {
        balance: number;
        delta: number;
        reason: string;
        ref: string;
      }[];
      // [seed row, vote row]
      expect(ledger).toHaveLength(2);
      const grant = ledger[1]!;
      expect(grant.delta).toBe(300);
      expect(grant.reason).toBe("vote");
      expect(grant.ref).toBe("votes+3");
      expect(grant.balance).toBe(startBal + 300);
    });

    it("does NOT write a ledger row when delta <= 0", () => {
      recordPoll(10, '{"votes":10}');
      const before = getDb()
        .prepare("SELECT COUNT(*) AS c FROM credit_ledger")
        .get() as { c: number };

      const flat = recordPoll(10, '{"votes":10}');
      expect(flat.delta).toBe(0);
      const drop = recordPoll(8, '{"votes":8}'); // negative delta is ignored
      expect(drop.delta).toBe(-2);

      const after = getDb()
        .prepare("SELECT COUNT(*) AS c FROM credit_ledger")
        .get() as { c: number };
      expect(after.c).toBe(before.c);
    });
  });

  describe("broadcaster", () => {
    it("delivers a 'vote' event on every poll", () => {
      const events: SseEvent[] = [];
      const unsub = broadcaster.subscribe((e) => events.push(e));
      try {
        recordPoll(1, '{"votes":1}');
        recordPoll(2, '{"votes":2}');
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ type: "vote", current: 1, delta: 0 });
        expect(events[1]).toMatchObject({ type: "vote", current: 2, delta: 1 });
      } finally {
        unsub();
      }
    });
  });

  describe("votesSummary", () => {
    it("returns the current shape expected by GET /api/votes", () => {
      recordPoll(1, '{"votes":1}');
      recordPoll(4, '{"votes":4}');
      const s = votesSummary();
      expect(s.current).toBe(4);
      expect(s.lastDelta).toBe(3);
      expect(s.history).toHaveLength(2);
      expect(s.history.map((h) => h.votes)).toEqual([1, 4]);
    });
  });

  describe("fetchLiveVotes", () => {
    it("returns null on non-2xx", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(
        async () => new Response("nope", { status: 500 }),
      ) as unknown as typeof fetch;
      try {
        const out = await fetchLiveVotes("https://example.test/x");
        expect(out).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns { votes, raw } on a 2xx with a recognized shape", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ votes: 12, name: "x" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch;
      try {
        const out = await fetchLiveVotes("https://example.test/x");
        expect(out).not.toBeNull();
        expect(out?.votes).toBe(12);
        expect(out?.raw).toContain('"votes":12');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("votePoller lifecycle", () => {
    /** Wait until the predicate is true or the deadline elapses. */
    async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (pred()) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("waitFor timed out");
    }

    it("startVotePoller is idempotent and stopVotePoller clears state", async () => {
      // Use a no-op SUBMISSIONS_URL to keep the test deterministic and
      // avoid the poller hammering the real network. The point here is
      // the state machine, not the network.
      const originalUrl = process.env.SUBMISSIONS_URL;
      process.env.SUBMISSIONS_URL = "https://127.0.0.1:1/never";
      try {
        startVotePoller();
        startVotePoller(); // second call is a no-op
        // The first async tick has to finish (and schedule the next
        // setTimeout in its finally) before `running` flips true.
        await waitFor(() => pollerState().running);
        expect(pollerState().running).toBe(true);
        stopVotePoller();
        // And the cleanup is synchronous.
        expect(pollerState().running).toBe(false);
      } finally {
        stopVotePoller();
        if (originalUrl === undefined) delete process.env.SUBMISSIONS_URL;
        else process.env.SUBMISSIONS_URL = originalUrl;
      }
    });
  });
});
