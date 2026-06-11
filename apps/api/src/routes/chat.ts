// HTTP route for chat.
//
//   POST /api/chat
//     body: { messages: [{ role, content }], sessionId?: string }
//     success: 200 { ok:true, balance, reply, model, tokensIn, tokensOut, latencyMs }
//     402: { error:'insufficient_credits', balance, required }
//     502: { error:'llm_error', message }   (sanitized — no API key leak)
//
// Flow (AC-5):
//   1. Validate the body (zod).
//   2. Concurrency-safe credit deduction. 402 on insufficient balance.
//   3. Call llm.chat() with a 30 s timeout and 8k/2k token caps.
//   4. On LLM failure, refund the 20 credits via recordGrant() so the
//      user is never charged for a failed/aborted call (the spec's
//      "failed calls do not deduct" rule), and respond 502.
//   5. On success, return the reply and the balance.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { tryDeduct, recordGrant } from "../services/credits.js";
import { config } from "../config.js";
import {
  chat as llmChat,
  safeLlmErrorResponse,
  LlmError,
} from "../services/llm.js";

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
  sessionId: z.string().min(1).optional(),
});

export const chatRouter = Router();

chatRouter.post("/", async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_body",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const sessionId = parsed.data.sessionId ?? randomUUID();
  const ref = `chat:${sessionId}:${parsed.data.messages.length}msgs`;

  // 1) Concurrency-safe credit deduction. AC-4 invariant: balance
  //    never goes negative; this is the only place that mutates the
  //    pool.
  const out = tryDeduct(config.CREDIT_PER_CHAT, "chat", ref);
  if (!out.ok) {
    res.status(402).json({
      error: "insufficient_credits",
      balance: out.balance,
      required: config.CREDIT_PER_CHAT,
    });
    return;
  }

  // 2) Call the LLM. On any failure, refund the 20 credits so the
  //    user isn't billed for a broken call.
  try {
    const reply = await llmChat(parsed.data.messages, { sessionId });
    res.status(200).json({
      ok: true,
      balance: out.newBalance,
      sessionId,
      reply: reply.content,
      model: reply.model,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      latencyMs: reply.latencyMs,
    });
  } catch (err) {
    // Refund. The ref on the refund row ties it back to the original
    // deduction so an operator can reconcile manually if needed.
    recordGrant(
      config.CREDIT_PER_CHAT,
      "chat-refund",
      `${ref}:refund`,
    );
    const safe = safeLlmErrorResponse(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[chat] llm call failed (${err instanceof LlmError ? err.httpStatus : "?"}); ` +
        `refunded ${config.CREDIT_PER_CHAT} credits to session ${sessionId}`,
    );
    res.status(safe.status).json(safe.body);
  }
});
