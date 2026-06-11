// LLM service: thin OpenAI-compatible client for the token-ai.cysic.xyz
// endpoint. Responsibilities (AC-5):
//
//   1. On first use, probe GET /v1/models and pick a model:
//        a) honor config.OPENAI_MODEL if set,
//        b) else prefer gpt-4o-mini,
//        c) else gpt-4o,
//        d) else the first id returned,
//      and cache the chosen id in this process AND on disk
//      (apps/api/src/services/llm.selectedModel.txt) so subsequent
//      boots can short-circuit the network probe.
//
//   2. chat(messages, opts) → POST /v1/chat/completions with an 8k/2k
//      token cap (input truncated by char, output capped via
//      `max_tokens: 2048`) and a 30 s AbortController timeout.
//
//   3. Throw LlmError on every failure (non-2xx, timeout, malformed
//      body, missing API key, network). The error NEVER carries the
//      API key, headers, or stack — it carries a short, safe message
//      so the route can render it through safeLlmErrorResponse().
//
//   4. On every successful call, INSERT a row into chat_log with
//      session_id, role='assistant', content, tokens_in, tokens_out,
//      and latency_ms (added by migration 0002_chat_log_latency.sql).
//
// We deliberately do NOT use the `openai` SDK: the upstream is a
// vanilla OpenAI-compatible endpoint and adding an SDK would just
// pull in another dep and obscure the very simple request shape we
// need.

import { config } from "../config.js";
import { getDb } from "../db/connection.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const PKG_ROOT = dirname(fileURLToPath(import.meta.url));
/**
 * Default cache file path. Can be overridden for tests via the
 * `LLM_MODEL_CACHE_FILE` env var (absolute path), which the test
 * suite uses to point at a tempdir so tests never collide with the
 * dev / prod cache.
 */
const CACHE_FILE = process.env["LLM_MODEL_CACHE_FILE"]
  ? resolve(process.env["LLM_MODEL_CACHE_FILE"])
  : join(PKG_ROOT, "llm.selectedModel.txt");

/** Hard caps from the AC-5 spec: 8k input, 2k output, 30 s timeout. */
export const MAX_INPUT_TOKENS = 8000;
export const MAX_OUTPUT_TOKENS = 2000;
/** 4 chars ≈ 1 token is a conservative heuristic. */
const CHARS_PER_TOKEN = 4;
const MAX_INPUT_CHARS = MAX_INPUT_TOKENS * CHARS_PER_TOKEN;
const REQUEST_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;

/** Custom error class. `message` is safe to surface to clients. */
export class LlmError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 502) {
    super(message);
    this.name = "LlmError";
    this.httpStatus = httpStatus;
  }
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  /** session_id used to attribute the chat_log row. */
  sessionId: string;
  /** Sampling temperature; default 0.7. */
  temperature?: number;
  /** Override the output cap. Capped to MAX_OUTPUT_TOKENS. */
  maxTokens?: number;
  /** Optional stop sequences. */
  stop?: string[];
  /** Override the model picker; mostly for tests. */
  model?: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

/* ------------------------------------------------------------------ */
/*  Model discovery                                                   */
/* ------------------------------------------------------------------ */

let cachedModel: string | null = null;
let probeInFlight: Promise<string> | null = null;

function authHeaders(): Record<string, string> {
  // We build the header here and ONLY here. safeLlmErrorResponse()
  // guarantees the key never leaves this file.
  if (!config.OPENAI_API_KEY) {
    throw new LlmError(
      "OPENAI_API_KEY is empty; cannot authorize LLM call",
      503,
    );
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.OPENAI_API_KEY}`,
  };
}

/** Read the disk cache, if any. Returns null on miss or empty. */
function readCacheFile(): string | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const txt = readFileSync(CACHE_FILE, "utf8").trim();
    return txt.length > 0 ? txt : null;
  } catch {
    return null;
  }
}

function writeCacheFile(model: string): void {
  try {
    writeFileSync(CACHE_FILE, model, "utf8");
  } catch {
    // Best-effort. A failed cache write is not a hard error — the
    // in-memory cache is still valid for this process.
  }
}

/**
 * Pick the model id to use for chat completions. Honors the explicit
 * `OPENAI_MODEL` env var; otherwise probes /v1/models and prefers
 * gpt-4o-mini, then gpt-4o, then the first id. The result is cached
 * in memory and on disk.
 *
 * Safe to call from any context; the probe is a single in-flight
 * promise (de-duped across concurrent callers in the same process).
 */
export async function pickModel(): Promise<string> {
  if (config.OPENAI_MODEL) {
    cachedModel = config.OPENAI_MODEL;
    return cachedModel;
  }
  if (cachedModel) return cachedModel;
  if (probeInFlight) return probeInFlight;

  // 1) Try the disk cache first — it survives process restarts and
  //    saves a network round-trip when the upstream is rate-limited.
  const fromDisk = readCacheFile();
  if (fromDisk) {
    cachedModel = fromDisk;
    return cachedModel;
  }

  // 2) Probe the upstream and pick the best id we can see.
  probeInFlight = (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${config.OPENAI_BASE_URL}/models`, {
        method: "GET",
        headers: authHeaders(),
        signal: ctl.signal,
      });
      if (!res.ok) {
        throw new LlmError(
          `Model probe failed: HTTP ${res.status}`,
          502,
        );
      }
      const body = (await res.json()) as { data?: { id: string }[] };
      const ids = (body.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ids.length === 0) {
        throw new LlmError("Model probe returned no models", 502);
      }
      const preferred = ["gpt-4o-mini", "gpt-4o"];
      const chosen =
        preferred.find((p) => ids.includes(p)) ?? ids[0]!;
      cachedModel = chosen;
      writeCacheFile(chosen);
      return chosen;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError(
        `Model probe failed: ${(err as Error).message}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  })();

  try {
    return await probeInFlight;
  } finally {
    probeInFlight = null;
  }
}

/** Test helper: drop the in-memory + on-disk cache. */
export function resetModelCache(): void {
  cachedModel = null;
  try {
    if (existsSync(CACHE_FILE)) {
      unlinkSync(CACHE_FILE);
    }
  } catch {
    /* noop — best effort */
  }
}

/**
 * Redact anything that looks like an API key, a Bearer token, or an
 * Authorization header value from a string. Used by
 * safeLlmErrorResponse() so even a misbehaving LlmError that
 * accidentally echoes the upstream's error body (or our own debug
 * text) can never leak the key.
 */
function redactSensitive(s: string): string {
  return s
    .replace(/\bsk-[A-Za-z0-9_\-]{6,}\b/g, "sk-***")
    .replace(/\bBearer\s+[A-Za-z0-9_\-\.]+/g, "Bearer ***")
    .replace(/\b(authorization\s*[:=]\s*)[^\s,;]+/gi, "$1***")
    .replace(/\b(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1***")
    .replace(/\b(OPENAI_API_KEY\s*[:=]\s*)[^\s,;]+/g, "$1***");
}

/* ------------------------------------------------------------------ */
/*  chat()                                                            */
/* ------------------------------------------------------------------ */

/**
 * Truncate the concatenated user content to fit the 8k input cap.
 * Truncates from the END of the last user message, preserving the
 * role ordering. Naive but safe: the LLM is the source of truth for
 * semantic truncation; this is just a hard guardrail.
 */
function truncateMessages(messages: ChatMessage[]): ChatMessage[] {
  let total = messages.reduce((n, m) => n + m.content.length, 0);
  if (total <= MAX_INPUT_CHARS) return messages;

  // Walk from the last user-tunable message backwards.
  for (let i = messages.length - 1; i >= 0 && total > MAX_INPUT_CHARS; i--) {
    const m = messages[i]!;
    if (m.role !== "user" && m.role !== "system") continue;
    const over = total - MAX_INPUT_CHARS;
    const trim = Math.min(m.content.length, over);
    messages[i] = { ...m, content: m.content.slice(0, m.content.length - trim) };
    total -= trim;
  }
  return messages;
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<ChatResponse> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new LlmError("chat() requires at least one message", 400);
  }
  if (!opts.sessionId || opts.sessionId.length === 0) {
    throw new LlmError("chat() requires opts.sessionId", 400);
  }

  const model = opts.model ?? (await pickModel());
  const trimmed = truncateMessages(messages.map((m) => ({ ...m })));
  const maxTokens = Math.min(
    opts.maxTokens ?? MAX_OUTPUT_TOKENS,
    MAX_OUTPUT_TOKENS,
  );
  const temperature = opts.temperature ?? 0.7;

  const start = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model,
        messages: trimmed,
        max_tokens: maxTokens,
        temperature,
        ...(opts.stop ? { stop: opts.stop } : {}),
      }),
      signal: ctl.signal,
    });

    if (!res.ok) {
      // Note: we intentionally do NOT read res.text() into the error
      // message — the upstream may echo fragments that contain the
      // key, the user's content, or other PII. A generic message is
      // safer; logs can record the status.
      throw new LlmError(
        `LLM call failed: HTTP ${res.status}`,
        res.status >= 400 && res.status < 600 ? res.status : 502,
      );
    }

    const body = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const tokensIn = body.usage?.prompt_tokens ?? 0;
    const tokensOut = body.usage?.completion_tokens ?? 0;
    const latencyMs = Date.now() - start;
    const returnedModel = body.model ?? model;

    // Persist the audit row. The credits service has already deducted
    // the 20-credit fee by the time we get here (the route orders
    // deduction first, LLM call second, and refunds on failure).
    getDb()
      .prepare(
        `INSERT INTO chat_log
           (session_id, role, content, tokens_in, tokens_out, latency_ms)
         VALUES (?, 'assistant', ?, ?, ?, ?)`,
      )
      .run(opts.sessionId, content, tokensIn, tokensOut, latencyMs);

    return {
      content,
      model: returnedModel,
      tokensIn,
      tokensOut,
      latencyMs,
    };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new LlmError("LLM call timed out after 30s", 504);
    }
    throw new LlmError(
      `LLM call failed: ${(err as Error).message}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  safeLlmErrorResponse() — shared by every route that calls chat   */
/* ------------------------------------------------------------------ */

/**
 * Convert any error into a { status, body } pair that is safe to send
 * to a browser. The body never contains the API key, the upstream's
 * raw response text, the stack, or any PII from the user's messages.
 *
 * Routes should call this from their catch and respond with it.
 */
export function safeLlmErrorResponse(
  err: unknown,
): { status: number; body: { error: string; message: string } } {
  if (err instanceof LlmError) {
    // Map any non-2xx upstream status to a generic 502, unless the
    // caller is asking for a specific client-visible status (e.g.
    // 400 for invalid input, 503 for missing key).
    const status =
      err.httpStatus === 400 || err.httpStatus === 503 ? err.httpStatus : 502;
    return {
      status,
      body: { error: "llm_error", message: redactSensitive(err.message) },
    };
  }
  return {
    status: 502,
    body: { error: "llm_error", message: "LLM call failed" },
  };
}

// Surface the cache-file path so tests can clean up after themselves.
export const LLM_CACHE_PATH = CACHE_FILE;
