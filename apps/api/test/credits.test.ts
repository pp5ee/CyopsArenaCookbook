import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDb, openDb, type DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  BLOCKED_THRESHOLD,
  getBalance,
  maybeBroadcastThreshold,
  recordGrant,
  tryDeduct,
} from "../src/services/credits.js";
import { broadcaster, type SseEvent } from "../src/sse/broadcaster.js";

/** Reset the credit pool to a known starting balance (truncates the ledger). */
function resetBalance(db: DB, balance: number): void {
  db.exec("DELETE FROM credit_ledger");
  db.prepare(
    `INSERT INTO credit_ledger (balance, delta, reason, ref)
     VALUES (?, ?, 'test-reset', 'init')`,
  ).run(balance, balance);
}

describe("credits service", () => {
  let workDir: string;
  let dbFile: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "cookbook-credits-"));
    dbFile = join(workDir, "credits.sqlite");
    setDb(openDb(dbFile));
    runMigrations();
  });

  afterEach(() => {
    setDb(null);
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("getBalance", () => {
    it("returns the AC-4 shape with perVote, perChat, blocked flag", () => {
      const b = getBalance();
      expect(b).toMatchObject({
        balance: 1000, // from the seed row
        perVote: 100,
        perChat: 20,
        blocked: false,
      });
    });

    it("flags blocked=true when balance is below 20", () => {
      resetBalance(openDb(dbFile), 15);
      const b = getBalance();
      expect(b.balance).toBe(15);
      expect(b.blocked).toBe(true);
    });
  });

  describe("tryDeduct", () => {
    it("succeeds and reports the new balance on a normal deduction", () => {
      const out = tryDeduct(20, "chat", "test:1");
      expect(out.ok).toBe(true);
      expect(out.newBalance).toBe(980);
      expect(getBalance().balance).toBe(980);
    });

    it("writes a credit_ledger row with negative delta and the new balance", () => {
      tryDeduct(20, "chat", "test:row");
      const rows = openDb(dbFile)
        .prepare(
          "SELECT balance, delta, reason, ref FROM credit_ledger ORDER BY id DESC LIMIT 1",
        )
        .all() as { balance: number; delta: number; reason: string; ref: string }[];
      expect(rows[0]).toEqual({
        balance: 980,
        delta: -20,
        reason: "chat",
        ref: "test:row",
      });
    });

    it("returns 402-style { ok:false, balance } when balance is below amount", () => {
      resetBalance(openDb(dbFile), 10);
      const out = tryDeduct(20, "chat", "test:broke");
      expect(out.ok).toBe(false);
      expect(out.balance).toBe(10);
      expect(out.newBalance).toBe(10);
      // No new ledger row was written.
      const count = openDb(dbFile)
        .prepare("SELECT COUNT(*) AS c FROM credit_ledger")
        .get() as { c: number };
      expect(count.c).toBe(1); // just the reset row
    });

    it("returns 402-style when the pool is empty", () => {
      resetBalance(openDb(dbFile), 0);
      const out = tryDeduct(20, "chat", "test:empty");
      expect(out.ok).toBe(false);
      expect(out.balance).toBe(0);
    });

    it("never goes negative even when 5 parallel calls hit a 100-credit pool", async () => {
      // From 100 credits, 5 deductions of 20 must drive the balance to
      // exactly 0; from 80, 4 succeed + 1 fails; from 50, 2 succeed + 3
      // fail. The SQL guard must never let the balance dip below 0.
      for (const start of [100, 80, 50] as const) {
        resetBalance(openDb(dbFile), start);

        const results = await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            Promise.resolve().then(() => tryDeduct(20, "chat", `parallel:${i}`)),
          ),
        );

        const oks = results.filter((r) => r.ok).length;
        const fails = results.filter((r) => !r.ok).length;
        expect(oks + fails).toBe(5);
        expect(fails).toBe(start / 20 > 5 ? 0 : 5 - Math.floor(start / 20));
        // balance invariant: never negative, never above start
        const finalBal = getBalance().balance;
        expect(finalBal).toBeGreaterThanOrEqual(0);
        expect(finalBal).toBeLessThanOrEqual(start);
        expect(finalBal).toBe(start - 20 * oks);
      }
    });
  });

  describe("recordGrant", () => {
    it("appends a positive ledger row and updates the balance", () => {
      const before = getBalance().balance;
      const out = recordGrant(100, "vote", "votes+1");
      expect(out.balance).toBe(before + 100);
      expect(out.delta).toBe(100);
      expect(out.reason).toBe("vote");
      expect(getBalance().balance).toBe(before + 100);
    });
  });

  describe("threshold broadcasts", () => {
    it("publishes 'credits' with blocked=true on the first edge-crossing into <20", () => {
      resetBalance(openDb(dbFile), 25);
      const events: SseEvent[] = [];
      const unsub = broadcaster.subscribe((e) => events.push(e));
      try {
        // 25 → 5: blocked flips to true
        const out = tryDeduct(20, "chat", "cross-down");
        expect(out.ok).toBe(true);
        expect(out.newBalance).toBe(5);

        const credits = events.filter((e) => e.type === "credits");
        expect(credits).toHaveLength(1);
        expect(credits[0]).toMatchObject({
          type: "credits",
          balance: 5,
          blocked: true,
        });
      } finally {
        unsub();
      }
    });

    it("publishes 'credits' with blocked=false on the first edge-crossing back to ≥20", () => {
      resetBalance(openDb(dbFile), 5);
      const events: SseEvent[] = [];
      const unsub = broadcaster.subscribe((e) => events.push(e));
      try {
        // 5 → 105: blocked flips to false
        recordGrant(100, "vote", "votes+1");
        const credits = events.filter((e) => e.type === "credits");
        expect(credits).toHaveLength(1);
        expect(credits[0]).toMatchObject({
          type: "credits",
          balance: 105,
          blocked: false,
        });
      } finally {
        unsub();
      }
    });

    it("does NOT broadcast when the balance stays on the same side of the threshold", () => {
      resetBalance(openDb(dbFile), 100);
      const events: SseEvent[] = [];
      const unsub = broadcaster.subscribe((e) => events.push(e));
      try {
        tryDeduct(20, "chat", "a"); // 100 → 80, still >= 20
        tryDeduct(20, "chat", "b"); // 80 → 60, still >= 20
        tryDeduct(20, "chat", "c"); // 60 → 40, still >= 20
        const credits = events.filter((e) => e.type === "credits");
        expect(credits).toEqual([]);
      } finally {
        unsub();
      }
    });

    it("maybeBroadcastThreshold returns true on edge-crossing, false otherwise", () => {
      expect(maybeBroadcastThreshold(30, 10)).toBe(true); // blocked: false → true
      expect(maybeBroadcastThreshold(10, 50)).toBe(true); // blocked: true → false
      expect(maybeBroadcastThreshold(40, 20)).toBe(false); // 20 is NOT < 20
      expect(maybeBroadcastThreshold(20, 19)).toBe(true); // 19 < 20
    });
  });

  describe("threshold constant sanity", () => {
    it("BLOCKED_THRESHOLD is 20 (matches the AC-4 plan)", () => {
      expect(BLOCKED_THRESHOLD).toBe(20);
    });
  });
});
