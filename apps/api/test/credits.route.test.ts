// End-to-end test for the AC-4 routes: GET /api/credits and
// POST /api/chat. Boots createApp() (no DB poller, no network) and
// exercises the real HTTP + service stack.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDb, openDb, type DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { createApp } from "../src/server.js";

function resetBalance(db: DB, balance: number): void {
  db.exec("DELETE FROM credit_ledger");
  db.prepare(
    `INSERT INTO credit_ledger (balance, delta, reason, ref)
     VALUES (?, ?, 'test-reset', 'init')`,
  ).run(balance, balance);
}

describe("credits routes", () => {
  let workDir: string;
  let dbFile: string;
  let server: import("node:http").Server;
  let port: number;

  beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), "cookbook-credits-routes-"));
    dbFile = join(workDir, "credits.sqlite");
    setDb(openDb(dbFile));
    runMigrations();
    seed();

    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((r) => server.on("listening", () => r()));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    setDb(null);
    rmSync(workDir, { recursive: true, force: true });
  });

  it("GET /api/credits returns the AC-4 shape", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/credits`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      balance: 1000,
      perVote: 100,
      perChat: 20,
      blocked: false,
    });
  });

  it("POST /api/chat deducts 20 credits and returns 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; balance: number; reply: string };
    expect(body.ok).toBe(true);
    expect(body.balance).toBe(980);
    expect(body.reply).toContain("AC-5");
  });

  it("POST /api/chat with insufficient balance returns 402", async () => {
    resetBalance(openDb(dbFile), 10);
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: string;
      balance: number;
      required: number;
    };
    expect(body.error).toBe("insufficient_credits");
    expect(body.balance).toBe(10);
    expect(body.required).toBe(20);
  });

  it("POST /api/chat with invalid body returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("5 parallel POSTs from 100 → balance=0, all 5 are 200, no 402s", async () => {
    resetBalance(openDb(dbFile), 100);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`http://127.0.0.1:${port}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const credits = (
      openDb(dbFile)
        .prepare("SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1")
        .get() as { balance: number }
    ).balance;
    expect(credits).toBe(0);
  });

  it("5 parallel POSTs from 80 → 4×200 + 1×402, balance=0", async () => {
    resetBalance(openDb(dbFile), 80);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`http://127.0.0.1:${port}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 402]);
    const credits = (
      openDb(dbFile)
        .prepare("SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1")
        .get() as { balance: number }
    ).balance;
    expect(credits).toBe(0);
  });
});
