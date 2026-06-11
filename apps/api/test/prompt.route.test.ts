// AC-6 HTTP-level tests for POST /api/prompt/start and
// POST /api/prompt/answer. Verifies the routes:
//   - /api/prompt/start returns the Socratic first question (no LLM
//     call, no credit deduction),
//   - /api/prompt/answer deducts 20 credits on success and returns
//     the next question or, on DONE, the rendered prompt + sections
//     + rubric_checklist,
//   - /api/prompt/answer returns 402 on insufficient balance and
//     502 (sanitized) on LLM failure — refunding the 20 credits so
//     failed calls don't deduct.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDb, openDb, type DB } from "../src/db/connection.js";
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

function okQuestion(q: string) {
  return {
    content: JSON.stringify({ question: q }),
    model: "gpt-4o-mini",
    tokensIn: 1,
    tokensOut: 1,
    latencyMs: 0,
  };
}

function okFinal() {
  return {
    content: JSON.stringify({
      project_title: "Cookbook Demo",
      track: "ship-a-feature",
      target_audience: "CyOpsxMinimax hackathon participants",
      success_criteria: [
        "Users can complete the start→DONE flow",
        "Prompt is a valid CyOps block",
      ],
      rubric_checklist: {
        implementation_engineering_quality: 20,
        architecture_complexity_fit: 16,
        deliverable_completeness: 20,
        project_copy_documentation: 16,
        ai_agent_integration: 20,
        implementation_innovation: 8,
      },
      sections: {
        problem: "Users need a Socratic prompt generator.",
        users: "Hackathon participants.",
        solution: "Brainstorming-skill state machine.",
        approach: "Step-by-step LLM turns.",
        tradeoffs: "More turns → more credit cost.",
        scorecard: "Strongest: deliverable_completeness.",
      },
    }),
    model: "gpt-4o-mini",
    tokensIn: 1,
    tokensOut: 1,
    latencyMs: 0,
  };
}

describe("prompt routes (AC-6 surface)", () => {
  let workDir: string;
  let dbFile: string;
  let server: import("node:http").Server;
  let port: number;

  beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), "cookbook-prompt-route-"));
    dbFile = join(workDir, "prompt.sqlite");
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

  it("/api/prompt/start: returns sessionId, question, step 0 (no LLM call, no deduction)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/prompt/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: "ship-a-feature", locale: "en" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      question: string;
      step: number;
      stepName: string;
    };
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.step).toBe(0);
    expect(body.stepName).toBe("INTENT");
    expect(body.question.length).toBeGreaterThan(0);

    // No LLM call.
    expect(llmChat).not.toHaveBeenCalled();
    // No credit deduction: balance should still be the seed (1000).
    const bal = (
      openDb(dbFile)
        .prepare("SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1")
        .get() as { balance: number }
    ).balance;
    expect(bal).toBe(1000);
  });

  it("/api/prompt/start with locale=zh returns the localized first question", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/prompt/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: null, locale: "zh" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { question: string };
    expect(body.question).toMatch(/[一-龥]/);
  });

  it("/api/prompt/start: invalid body returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/prompt/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: "not-a-track" }),
    });
    expect(res.status).toBe(400);
  });

  it("/api/prompt/answer: deducts 20 on success and returns the next question", async () => {
    // 1) Start the session.
    const startRes = await fetch(`http://127.0.0.1:${port}/api/prompt/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: "ship-a-feature" }),
    });
    const start = (await startRes.json()) as { sessionId: string };

    // 2) Answer — mock returns the next question.
    vi.mocked(llmChat).mockResolvedValueOnce(okQuestion("Q2: who is the user?"));

    const res = await fetch(`http://127.0.0.1:${port}/api/prompt/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: start.sessionId, answer: "Build a thing" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      step: number;
      stepName: string;
      question: string;
      balance: number;
    };
    expect(body.stepName).toBe("CONTEXT");
    expect(body.question).toBe("Q2: who is the user?");
    expect(body.balance).toBe(980); // 1000 - 20
  });

  it("/api/prompt/answer: insufficient balance returns 402 and never calls the LLM", async () => {
    const startRes = await fetch(`http://127.0.0.1:${port}/api/prompt/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: null }),
    });
    const start = (await startRes.json()) as { sessionId: string };

    resetBalance(openDb(dbFile), 10);

    const res = await fetch(`http://127.0.0.1:${port}/api/prompt/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: start.sessionId, answer: "x" }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; balance: number };
    expect(body.error).toBe("insufficient_credits");
    expect(body.balance).toBe(10);
    expect(llmChat).not.toHaveBeenCalled();
  });

  it("/api/prompt/answer: LLM failure returns 502 (sanitized) and refunds 20 credits", async () => {
    const startRes = await fetch(`http://127.0.0.1:${port}/api/prompt/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: null }),
    });
    const start = (await startRes.json()) as { sessionId: string };

    vi.mocked(llmChat).mockRejectedValueOnce(
      new LlmError("Authorization: Bearer sk-SECRET-LEAK", 500),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/prompt/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: start.sessionId, answer: "x" }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("llm_error");
    // No key leak.
    expect(JSON.stringify(body)).not.toContain("sk-SECRET-LEAK");

    // Refund: net balance is 1000 (seed) plus nothing.
    const bal = (
      openDb(dbFile)
        .prepare("SELECT balance FROM credit_ledger ORDER BY id DESC LIMIT 1")
        .get() as { balance: number }
    ).balance;
    expect(bal).toBe(1000);
  });

  it("/api/prompt/answer: full 6-answer flow ends with done:true and rubric checklist", async () => {
    const startRes = await fetch(`http://127.0.0.1:${port}/api/prompt/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: "ship-a-feature" }),
    });
    const start = (await startRes.json()) as { sessionId: string };

    let call = 0;
    vi.mocked(llmChat).mockImplementation(async () => {
      call += 1;
      if (call <= 5) return okQuestion(`follow-up ${call}`);
      return okFinal();
    });

    let last: { done?: boolean; rubricChecklist?: unknown; prompt?: string } = {};
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/api/prompt/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: start.sessionId, answer: `a${i}` }),
      });
      expect(r.status).toBe(200);
      last = (await r.json()) as typeof last;
    }
    expect(last.done).toBe(true);
    expect(last.rubricChecklist).toEqual({
      implementation_engineering_quality: 20,
      architecture_complexity_fit: 16,
      deliverable_completeness: 20,
      project_copy_documentation: 16,
      ai_agent_integration: 20,
      implementation_innovation: 8,
    });
    expect(last.prompt).toMatch(/^---\ntrack: ship-a-feature/);
  });

  it("/api/prompt/answer: unknown sessionId returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/prompt/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "ghost", answer: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("/api/prompt/answer: empty answer returns 400", async () => {
    const startRes = await fetch(`http://127.0.0.1:${port}/api/prompt/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: null }),
    });
    const start = (await startRes.json()) as { sessionId: string };
    const res = await fetch(`http://127.0.0.1:${port}/api/prompt/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: start.sessionId, answer: "   " }),
    });
    expect(res.status).toBe(400);
  });
});
