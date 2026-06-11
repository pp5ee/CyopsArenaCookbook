// Seed: idempotently insert the starting credit row.
// Run directly: `pnpm --filter @cookbook/api seed`
// Behavior: only writes the initial CREDIT_START row if the ledger is empty.

import { config } from "../config.js";
import { getDb, openDb } from "./connection.js";
import { runMigrations } from "./migrate.js";

export function seed(db = getDb()): { inserted: boolean; balance: number } {
  runMigrations(db);

  // "Empty" check: cheap LIMIT 1 lookup, no sort.
  const present = db
    .prepare(`SELECT 1 AS one FROM credit_ledger LIMIT 1`)
    .get() as { one: number } | undefined;
  if (present) {
    const last = db
      .prepare(`SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1`)
      .get() as { balance: number };
    return { inserted: false, balance: last.balance };
  }

  db.prepare(
    `INSERT INTO credit_ledger (balance, delta, reason, ref)
     VALUES (?, ?, 'seed', 'init')`,
  ).run(config.CREDIT_START, config.CREDIT_START);

  return { inserted: true, balance: config.CREDIT_START };
}

// CLI entry: `pnpm --filter @cookbook/api seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  try {
    const res = seed(db);
    // eslint-disable-next-line no-console
    console.log(
      `[seed] ${res.inserted ? "inserted" : "already-seeded"} balance=${res.balance}`,
    );
  } finally {
    db.close();
  }
}
