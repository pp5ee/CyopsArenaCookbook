// DB connection helper. Single shared better-sqlite3 handle, WAL mode, foreign keys on.
import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "../config.js";

export type DB = Database.Database;

let _db: DB | null = null;

export function openDb(file: string = config.DATABASE_FILE): DB {
  const dir = dirname(file);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function getDb(): DB {
  if (!_db) {
    _db = openDb();
  }
  return _db;
}

/** Test helper: swap the singleton for an in-memory or alternate DB. */
export function setDb(db: DB | null): void {
  _db = db;
}
