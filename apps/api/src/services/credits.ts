// Credit pool service.
//
// The pool is a single global ledger: every mutation lands in
// `credit_ledger`, and the latest row's `balance` is the current pool
// balance. The plan pins two invariants:
//
//   1. Concurrency-safe deduction. The deduction is a single guarded
//      UPDATE on the latest row, inside a transaction. No read-then-write
//      of the balance anywhere in the app — the SQL guard is the lock.
//
//   2. Threshold broadcast. We publish a { type:'credits', balance,
//      blocked } SSE event on the FIRST edge-crossing of the 20-credit
//      threshold (drops below 20 or returns to ≥ 20). Subsequent
//      deductions that stay in the same side of the threshold are silent.

import { config } from "../config.js";
import { getDb } from "../db/connection.js";
import { broadcaster } from "../sse/broadcaster.js";

export const BLOCKED_THRESHOLD = 20; // < 20 means the pool is blocked

export interface CreditBalance {
  balance: number;
  perVote: number;
  perChat: number;
  blocked: boolean;
}

/** Read the current pool balance (and its derived flags). */
export function getBalance(db = getDb()): CreditBalance {
  const row = db
    .prepare(`SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1`)
    .get() as { balance: number } | undefined;
  const balance = row?.balance ?? 0;
  return {
    balance,
    perVote: config.CREDIT_PER_VOTE,
    perChat: config.CREDIT_PER_CHAT,
    blocked: balance < BLOCKED_THRESHOLD,
  };
}

export interface DeductOutcome {
  ok: boolean;
  balance: number;
  newBalance: number;
}

/**
 * Attempt to deduct `amount` credits. Uses a single guarded UPDATE inside
 * a transaction so concurrent calls cannot drive the balance negative:
 * if the latest row's balance is < amount, no row matches the WHERE
 * clause, `changes()` returns 0, and we return `{ ok:false, balance }`.
 */
export function tryDeduct(
  amount: number,
  reason: string,
  ref: string | null,
  db = getDb(),
): DeductOutcome {
  const before = getBalance(db).balance;

  const tx = db.transaction(() => {
    return db
      .prepare(
        `UPDATE credit_ledger
         SET balance = balance - ?
         WHERE id = (SELECT id FROM credit_ledger ORDER BY id DESC LIMIT 1)
           AND balance >= ?`,
      )
      .run(amount, amount);
  });
  const result = tx();

  if (result.changes === 0) {
    return { ok: false, balance: before, newBalance: before };
  }

  const newBalance = before - amount;
  maybeBroadcastThreshold(before, newBalance);
  return { ok: true, balance: newBalance, newBalance };
}

export interface GrantOutcome {
  balance: number;
  delta: number;
  reason: string;
  ref: string | null;
}

/**
 * Append a positive-credit row to the ledger. Used by the vote poller
 * (+100 per new vote) and any future top-up flow.
 *
 * INVARIANT: `delta` is the historical change that CREATED this row
 * (e.g. +1000 for the seed, +100 per vote, +20 for a refund). It is
 * NOT the change vs the previous row — deductions use an in-place
 * UPDATE on the latest row's `balance` and leave `delta` unchanged.
 * So `balance` is the running total; `delta` describes how this row
 * came to exist, not the diff to the row before it.
 */
export function recordGrant(
  delta: number,
  reason: string,
  ref: string | null,
  db = getDb(),
): GrantOutcome {
  const before = getBalance(db).balance;
  const newBalance = before + delta;
  db.prepare(
    `INSERT INTO credit_ledger (balance, delta, reason, ref)
     VALUES (?, ?, ?, ?)`,
  ).run(newBalance, delta, reason, ref);
  maybeBroadcastThreshold(before, newBalance);
  return { balance: newBalance, delta, reason, ref };
}

/**
 * Publish a { type:'credits', balance, blocked } event on the FIRST
 * edge-crossing of the 20-credit threshold. Stays silent when the
 * balance remains on the same side.
 *
 * This is the only place that emits 'credits' SSE events, so the union
 * in `sse/broadcaster.ts` stays honest.
 */
export function maybeBroadcastThreshold(
  before: number,
  after: number,
): boolean {
  const wasBlocked = before < BLOCKED_THRESHOLD;
  const isBlocked = after < BLOCKED_THRESHOLD;
  if (wasBlocked === isBlocked) return false;
  broadcaster.publish({ type: "credits", balance: after, blocked: isBlocked });
  return true;
}
