// Migrate: apply every SQL file in apps/api/src/db/migrations/ whose name
// is lexicographically greater than the highest version already recorded in
// `meta`. Re-runnable; idempotent.
//
// Run directly: `pnpm --filter @cookbook/api migrate`
// Run on boot:   `await runMigrations();` from server.ts

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDb, openDb } from "./connection.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

function appliedVersions(db: ReturnType<typeof getDb>): Set<string> {
  db.exec(
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );
  const rows = db
    .prepare(`SELECT value FROM meta WHERE key = 'applied_migrations'`)
    .get() as { value: string } | undefined;
  if (!rows) return new Set();
  try {
    return new Set(JSON.parse(rows.value) as string[]);
  } catch {
    return new Set();
  }
}

function recordApplied(
  db: ReturnType<typeof getDb>,
  versions: Set<string>,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('applied_migrations', ?)`,
  ).run(JSON.stringify([...versions].sort()));
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function runMigrations(db = getDb()): MigrationResult {
  const files = listMigrationFiles();
  const applied = appliedVersions(db);
  const newly: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
    });
    tx();
    applied.add(file);
    newly.push(file);
    // eslint-disable-next-line no-console
    console.log(`[migrate] applied ${file}`);
  }

  if (newly.length > 0) {
    recordApplied(db, applied);
  }
  return { applied: newly, skipped: files.filter((f) => !newly.includes(f)) };
}

// CLI entry: `pnpm --filter @cookbook/api migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  try {
    const res = runMigrations(db);
    // eslint-disable-next-line no-console
    console.log(
      `[migrate] done. applied=${res.applied.length} skipped=${res.skipped.length}`,
    );
  } finally {
    db.close();
  }
}
