import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, setDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { config } from "../src/config.js";

describe("db schema and seed", () => {
  let workDir: string;
  let dbFile: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "cookbook-db-"));
    dbFile = join(workDir, "test.sqlite");
    setDb(openDb(dbFile));
  });

  afterEach(() => {
    setDb(null);
    rmSync(workDir, { recursive: true, force: true });
  });

  it("creates the four AC-2 tables on first migrate", () => {
    const { applied } = runMigrations();
    expect(applied).toContain("0001_init.sql");

    const tables = (
      openDb(dbFile)
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "chat_log",
        "credit_ledger",
        "meta",
        "prompt_draft",
        "vote_snapshot",
      ]),
    );
  });

  it("is idempotent: a second migrate() is a no-op", () => {
    runMigrations();
    const second = runMigrations();
    expect(second.applied).toEqual([]);
  });

  it("seed inserts a single starting row equal to CREDIT_START", () => {
    runMigrations();
    const res = seed();
    expect(res.inserted).toBe(true);
    expect(res.balance).toBe(config.CREDIT_START);

    const rows = openDb(dbFile)
      .prepare("SELECT balance, delta, reason, ref FROM credit_ledger")
      .all() as { balance: number; delta: number; reason: string; ref: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.balance).toBe(config.CREDIT_START);
    expect(rows[0]?.delta).toBe(config.CREDIT_START);
    expect(rows[0]?.reason).toBe("seed");
    expect(rows[0]?.ref).toBe("init");
  });

  it("seed is idempotent: a second call is a no-op", () => {
    runMigrations();
    seed();
    const second = seed();
    expect(second.inserted).toBe(false);

    const count = (
      openDb(dbFile)
        .prepare("SELECT COUNT(*) AS c FROM credit_ledger")
        .get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });
});
