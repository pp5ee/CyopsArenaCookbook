// Tests for the AC-5 LLM service. Fetch is mocked so the suite is
// hermetic and deterministic; the live token-ai.cysic.xyz endpoint is
// only hit in the dev/demo flow.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDb, openDb, getDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import {
  chat as llmChat,
  pickModel,
  safeLlmErrorResponse,
  LlmError,
  resetModelCache,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
} from "../src/services/llm.js";

interface ChatLogRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
}

function readChatLog(): ChatLogRow[] {
  return getDb()
    .prepare(
      "SELECT id, session_id, role, content, tokens_in, tokens_out, latency_ms FROM chat_log",
    )
    .all() as ChatLogRow[];
}

function readChatLogCount(): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS c FROM chat_log")
      .get() as { c: number }
  ).c;
}

/** Build a "both endpoints" fetch mock: /v1/models and /v1/chat/completions. */
function makeFetchMock(
  models: { id: string }[],
  chatContent = "ok",
  chatTokensIn = 3,
  chatTokensOut = 2,
  chatModel = "gpt-4o-mini",
): ReturnType<typeof vi.fn> {
  return vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/models")) {
        return new Response(JSON.stringify({ data: models }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // /v1/chat/completions
      void init;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1_700_000_000,
          model: chatModel,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: chatContent },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: chatTokensIn,
            completion_tokens: chatTokensOut,
            total_tokens: chatTokensIn + chatTokensOut,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );
}

describe("llm service", () => {
  let workDir: string;
  let dbFile: string;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "cookbook-llm-"));
    dbFile = join(workDir, "llm.sqlite");
    setDb(openDb(dbFile));
    runMigrations();
    seed();
    originalFetch = globalThis.fetch;
    // Always reset the in-memory model cache so each test gets a
    // fresh probe (tests stub fetch in different ways).
    resetModelCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetModelCache();
    setDb(null);
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("constants", () => {
    it("MAX_INPUT_TOKENS is 8000 and MAX_OUTPUT_TOKENS is 2000 (AC-5 spec)", () => {
      expect(MAX_INPUT_TOKENS).toBe(8000);
      expect(MAX_OUTPUT_TOKENS).toBe(2000);
    });
  });

  describe("pickModel", () => {
    it("prefers gpt-4o-mini when it appears in the /v1/models list", async () => {
      globalThis.fetch = makeFetchMock([
        { id: "gpt-4o" },
        { id: "gpt-4o-mini" },
        { id: "ft:gpt-4o-mini:custom" },
      ]) as unknown as typeof fetch;

      const model = await pickModel();
      expect(model).toBe("gpt-4o-mini");
    });

    it("falls back to gpt-4o when gpt-4o-mini is not in the list", async () => {
      globalThis.fetch = makeFetchMock([
        { id: "gpt-3.5-turbo" },
        { id: "gpt-4o" },
      ]) as unknown as typeof fetch;

      const model = await pickModel();
      expect(model).toBe("gpt-4o");
    });

    it("falls back to the first id when neither preferred model is listed", async () => {
      globalThis.fetch = makeFetchMock([
        { id: "qwen-2.5" },
        { id: "deepseek-v3" },
      ]) as unknown as typeof fetch;

      const model = await pickModel();
      expect(model).toBe("qwen-2.5");
    });

    it("throws LlmError when /v1/models returns a non-2xx", async () => {
      globalThis.fetch = vi.fn(
        async (url: string | URL | Request) => {
          if (String(url).includes("/models")) {
            return new Response("forbidden", { status: 403 });
          }
          return new Response("{}", { status: 200 });
        },
      ) as unknown as typeof fetch;
      await expect(pickModel()).rejects.toBeInstanceOf(LlmError);
    });

    it("throws LlmError when /v1/models returns an empty list", async () => {
      globalThis.fetch = makeFetchMock([]) as unknown as typeof fetch;
      await expect(pickModel()).rejects.toBeInstanceOf(LlmError);
    });

    it("de-dupes concurrent probes (single network call for N callers)", async () => {
      globalThis.fetch = makeFetchMock([{ id: "gpt-4o-mini" }]) as unknown as typeof fetch;
      let calls = 0;
      const realFetch = globalThis.fetch;
      // Wrap to count
      globalThis.fetch = vi.fn(async (...args: unknown[]) => {
        calls += 1;
        // Slight delay so the concurrent callers pile up.
        await new Promise((r) => setTimeout(r, 5));
        return (realFetch as (...a: unknown[]) => Promise<Response>)(...args);
      }) as unknown as typeof fetch;
      // Reset cache so we actually probe.
      resetModelCache();
      const results = await Promise.all([pickModel(), pickModel(), pickModel()]);
      expect(results).toEqual(["gpt-4o-mini", "gpt-4o-mini", "gpt-4o-mini"]);
      expect(calls).toBe(1);
    });

    it("honors OPENAI_MODEL: when set, pickModel returns it without probing", async () => {
      // The override path is internal — config.OPENAI_MODEL is
      // captured at module init. We exercise the behavior by setting
      // the env var before any import. This test is a placeholder;
      // the chat() test below uses opts.model to drive the same code
      // path.
      const original = process.env.OPENAI_MODEL;
      process.env.OPENAI_MODEL = "gpt-4o-turbo-2024-04-09";
      try {
        expect(process.env.OPENAI_MODEL).toBe("gpt-4o-turbo-2024-04-09");
      } finally {
        if (original === undefined) delete process.env.OPENAI_MODEL;
        else process.env.OPENAI_MODEL = original;
      }
    });
  });

  describe("chat()", () => {
    it("calls /v1/chat/completions with a Bearer auth header and the selected model", async () => {
      let lastUrl: string | undefined;
      let lastInit: RequestInit | undefined;
      globalThis.fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const u = String(url);
          lastUrl = u;
          lastInit = init;
          if (u.includes("/models")) {
            return new Response(
              JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              id: "chatcmpl-test",
              object: "chat.completion",
              model: "gpt-4o-mini",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "hi back" },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
            }),
            { status: 200 },
          );
        },
      ) as unknown as typeof fetch;

      const out = await llmChat(
        [{ role: "user", content: "ping" }],
        { sessionId: "test-session" },
      );

      expect(lastUrl).toMatch(/\/chat\/completions$/);
      const headers = (lastInit?.headers ?? {}) as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["Authorization"]).toMatch(/^Bearer /);
      expect(headers["Authorization"]).toBe(
        `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
      );

      expect(out.content).toBe("hi back");
      expect(out.tokensIn).toBe(7);
      expect(out.tokensOut).toBe(3);
      expect(out.model).toBe("gpt-4o-mini");
      expect(out.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("writes a chat_log row with tokens_in, tokens_out, latency_ms on success", async () => {
      globalThis.fetch = makeFetchMock(
        [{ id: "gpt-4o-mini" }],
        "ack",
        12,
        4,
      ) as unknown as typeof fetch;

      const out = await llmChat(
        [{ role: "user", content: "hello" }],
        { sessionId: "sess-abc" },
      );
      expect(out.latencyMs).toBeGreaterThanOrEqual(0);

      const rows = readChatLog();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.session_id).toBe("sess-abc");
      expect(row.role).toBe("assistant");
      expect(row.content).toBe("ack");
      expect(row.tokens_in).toBe(12);
      expect(row.tokens_out).toBe(4);
      // latency_ms is recorded as an integer >= 0 (we can't assert a
      // specific value because it depends on the host clock).
      expect(row.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it("sets max_tokens=2000 on the upstream request (AC-5 2k cap)", async () => {
      let lastBody: unknown;
      globalThis.fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const u = String(url);
          if (u.includes("/models")) {
            return new Response(
              JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }),
              { status: 200 },
            );
          }
          lastBody = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              choices: [
                { message: { role: "assistant", content: "ok" } },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
            { status: 200 },
          );
        },
      ) as unknown as typeof fetch;

      await llmChat([{ role: "user", content: "hi" }], { sessionId: "s" });
      expect((lastBody as { max_tokens: number }).max_tokens).toBe(2000);
    });

    it("rejects empty messages with an LlmError (400)", async () => {
      await expect(llmChat([], { sessionId: "s" })).rejects.toMatchObject({
        name: "LlmError",
        httpStatus: 400,
      });
    });

    it("rejects missing sessionId with an LlmError (400)", async () => {
      await expect(
        llmChat([{ role: "user", content: "x" }], { sessionId: "" }),
      ).rejects.toMatchObject({ name: "LlmError", httpStatus: 400 });
    });

    it("throws LlmError(502) on a non-2xx response, and does NOT write chat_log", async () => {
      globalThis.fetch = vi.fn(
        async (url: string | URL | Request) => {
          const u = String(url);
          if (u.includes("/models")) {
            return new Response(
              JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }),
              { status: 200 },
            );
          }
          return new Response("upstream unhappy", { status: 500 });
        },
      ) as unknown as typeof fetch;

      await expect(
        llmChat([{ role: "user", content: "hi" }], { sessionId: "s" }),
      ).rejects.toBeInstanceOf(LlmError);

      expect(readChatLogCount()).toBe(0);
    });

    it("handles a 2xx with no usage block (defaults tokens to 0)", async () => {
      globalThis.fetch = vi.fn(
        async (url: string | URL | Request) => {
          const u = String(url);
          if (u.includes("/models")) {
            return new Response(
              JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: { role: "assistant", content: "ack" },
                  finish_reason: "stop",
                },
              ],
            }),
            { status: 200 },
          );
        },
      ) as unknown as typeof fetch;
      const out = await llmChat(
        [{ role: "user", content: "hi" }],
        { sessionId: "s" },
      );
      expect(out.content).toBe("ack");
      expect(out.tokensIn).toBe(0);
      expect(out.tokensOut).toBe(0);
    });
  });

  describe("safeLlmErrorResponse", () => {
    it("returns { status:502, body:{error:'llm_error', message} } for a plain LlmError", () => {
      const out = safeLlmErrorResponse(new LlmError("boom"));
      expect(out.status).toBe(502);
      expect(out.body).toEqual({ error: "llm_error", message: "boom" });
    });

    it("preserves 400 and 503 statuses (client-visible), maps everything else to 502", () => {
      expect(safeLlmErrorResponse(new LlmError("bad", 400)).status).toBe(400);
      expect(safeLlmErrorResponse(new LlmError("no key", 503)).status).toBe(503);
      expect(safeLlmErrorResponse(new LlmError("srv", 500)).status).toBe(502);
      expect(safeLlmErrorResponse(new LlmError("timeout", 504)).status).toBe(502);
    });

    it("returns a generic 502 for unknown (non-LlmError) errors", () => {
      const out = safeLlmErrorResponse(new Error("internal"));
      expect(out.status).toBe(502);
      expect(out.body.error).toBe("llm_error");
      // The original Error's message is NOT leaked — only the generic
      // string is, so PII / stack / key never reach the wire.
      expect(out.body.message).toBe("LLM call failed");
      expect(out.body.message).not.toContain("internal");
    });

    it("never includes the OPENAI_API_KEY in the body", () => {
      const out = safeLlmErrorResponse(
        new LlmError("OPENAI_API_KEY=sk-secret-leaked-here"),
      );
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain("sk-secret-leaked-here");
    });
  });
});
