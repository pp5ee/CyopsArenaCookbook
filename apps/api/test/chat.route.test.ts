// AC-5 HTTP-level tests for POST /api/chat. Verifies the route:
//   - returns 200 with { reply, model, tokensIn, tokensOut, latencyMs }
//     on a successful LLM call,
//   - returns 502 (sanitized) on an LLM failure AND refunds the
//     20 credits via recordGrant (so failed calls don't deduct),
//   - never includes the OPENAI_API_KEY in the response body or
//     headers, even when the upstream's error message would have
//     leaked it,
//   - writes a chat_log row on success and NOTHING on failure.
//
// The LLM service is mocked per-test via vi.mocked(llmChat) so we
// can simulate success, failure, and key-leak scenarios without
// touching the network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDb, openDb, getDb, type DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { createApp } from "../src/server.js";

vi.mock("../src/services/llm.js", async () => {
  const real = await vi.importActual<
    typeof import("../src/services/llm.js")
  >("../src/services/llm.js");
  return {
    ...real,
    chat: vi.fn(),
    pickModel: vi.fn(async () => "gpt-4o-mini"),
  };
});

const { chat: llmChat, LlmError } = await import("../src/services/llm.js");

function resetBalance(db: DB, balance: number): void {
  db.exec("DELETE FROM credit_ledger");
  db.prepare(
    `INSERT INTO credit_ledger (balance, delta, reason, ref)
     VALUES (?, ?, 'test-reset', 'init')`,
  ).run(balance, balance);
}

describe("chat route (AC-5 surface)", () => {
  let workDir: string;
  let dbFile: string;
  let server: import("node:http").Server;
  let port: number;

  beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), "cookbook-chat-route-"));
    dbFile = join(workDir, "chat.sqlite");
    setDb(openDb(dbFile));
    runMigrations();
    seed();
    vi.mocked(llmChat).mockReset();
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

  it("happy path: 200 with reply, model, tokens, latency, balance, sessionId", async () => {
    vi.mocked(llmChat).mockImplementation(async (messages, opts) => {
      // Simulate what the real chat() does on success: write a
      // chat_log row, then return the canned response. This keeps
      // the route's behavior end-to-end without a real network.
      const out = {
        content: "hello back",
        model: "gpt-4o-mini",
        tokensIn: 11,
        tokensOut: 5,
        latencyMs: 42,
      };
      getDb()
        .prepare(
          "INSERT INTO chat_log (session_id, role, content, tokens_in, tokens_out, latency_ms) VALUES (?, 'assistant', ?, ?, ?, ?)",
        )
        .run(opts.sessionId, out.content, out.tokensIn, out.tokensOut, out.latencyMs);
      void messages;
      return out;
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
        sessionId: "client-1",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      balance: number;
      reply: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      latencyMs: number;
      sessionId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.balance).toBe(980);
    expect(body.reply).toBe("hello back");
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.tokensIn).toBe(11);
    expect(body.tokensOut).toBe(5);
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.sessionId).toBe("client-1");

    // chat_log row written with the right attribution
    const rows = openDb(dbFile)
      .prepare(
        "SELECT session_id, role, content, tokens_in, tokens_out, latency_ms FROM chat_log",
      )
      .all() as {
      session_id: string;
      role: string;
      content: string;
      tokens_in: number;
      tokens_out: number;
      latency_ms: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_id: "client-1",
      role: "assistant",
      content: "hello back",
      tokens_in: 11,
      tokens_out: 5,
    });
  });

  it("generates a sessionId when the client does not supply one", async () => {
    vi.mocked(llmChat).mockResolvedValue({
      content: "ok",
      model: "gpt-4o-mini",
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 0,
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    const body = (await res.json()) as { sessionId: string };
    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId.length).toBeGreaterThan(0);
  });

  it("LLM failure: 502, sanitized body, NO key leak, credit refunded to 1000", async () => {
    // The mock throws an LlmError whose message LEAKS the secret
    // upstream error text. The route's safeLlmErrorResponse helper
    // must redact it.
    vi.mocked(llmChat).mockRejectedValue(
      new LlmError(
        "upstream said: Authorization: Bearer sk-SECRET-LEAKED-12345",
        500,
      ),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("llm_error");
    // The upstream's leaked key must NOT appear anywhere in the
    // sanitized body.
    expect(JSON.stringify(body)).not.toContain("sk-SECRET-LEAKED-12345");
    expect(JSON.stringify(body)).not.toContain("Bearer");

    // Credit was deducted, then refunded: net balance is the seed
    // (1000) plus nothing. The latest row should reflect the refund.
    const bal = (
      openDb(dbFile)
        .prepare("SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1")
        .get() as { balance: number }
    ).balance;
    expect(bal).toBe(1000);

    // No chat_log row was written.
    const logCount = (
      openDb(dbFile)
        .prepare("SELECT COUNT(*) AS c FROM chat_log")
        .get() as { c: number }
    ).c;
    expect(logCount).toBe(0);
  });

  it("LLM failure: refund is a separate ledger row, reason='chat-refund'", async () => {
    vi.mocked(llmChat).mockRejectedValue(new LlmError("nope", 500));

    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    expect(res.status).toBe(502);

    const rows = openDb(dbFile)
      .prepare(
        "SELECT balance, delta, reason, ref FROM credit_ledger ORDER BY id ASC",
      )
      .all() as {
      balance: number;
      delta: number;
      reason: string;
      ref: string;
    }[];
    // AC-4 invariant: tryDeduct updates the latest row IN PLACE
    // (no new row). So the ledger is:
    //   [id=1: seed 1000 → updated in place to 980 (reason still 'seed')],
    //   [id=2: refund grant, balance back to 1000, reason 'chat-refund'].
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ balance: 980, reason: "seed" });
    expect(rows[1]).toMatchObject({
      balance: 1000,
      delta: 20,
      reason: "chat-refund",
    });
    // The refund's ref contains the original deduction's ref so
    // reconciliation is possible.
    expect(rows[1]!.ref).toContain(":refund");
  });

  it("LLM timeout: 504 mapped to 502, credit refunded", async () => {
    vi.mocked(llmChat).mockRejectedValue(new LlmError("upstream timed out", 504));

    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    expect(res.status).toBe(502); // safeLlmErrorResponse maps 504 → 502
    const bal = (
      openDb(dbFile)
        .prepare("SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1")
        .get() as { balance: number }
    ).balance;
    expect(bal).toBe(1000); // refunded
  });

  it("insufficient credits short-circuits — the LLM is never called", async () => {
    resetBalance(openDb(dbFile), 10);
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    expect(res.status).toBe(402);
    expect(llmChat).not.toHaveBeenCalled();
  });
});
