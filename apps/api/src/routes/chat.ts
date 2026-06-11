// HTTP route for chat.
//
//   POST /api/chat
//     body: { messages?: { role, content }[] }
//     success: 200 { ok:true,  balance, reply: "..." }
//     failure: 402 { error:"insufficient_credits", balance }
//
// AC-4 scope: this route exists to enforce the credit-deduction
// invariant. The "reply" body is a placeholder; AC-5 replaces the
// handler with a real LLM call and writes a row to chat_log. Keeping
// the credit gating here means AC-5 can be a pure swap of the
// "generate reply" step without re-touching the ledger SQL.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { tryDeduct } from "../services/credits.js";
import { config } from "../config.js";

// Body is intentionally permissive in AC-4 (any JSON object). AC-5
// tightens this to { messages: [{ role, content }] } with a zod
// schema, so the route stays a one-line swap when that lands.
const BodySchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().min(1),
        }),
      )
      .optional(),
  })
  .passthrough();

export const chatRouter = Router();

chatRouter.post("/", (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_body",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const ref = parsed.data.messages && parsed.data.messages.length > 0
    ? `chat:${parsed.data.messages.length}msgs`
    : "chat";

  const out = tryDeduct(config.CREDIT_PER_CHAT, "chat", ref);
  if (!out.ok) {
    res.status(402).json({
      error: "insufficient_credits",
      balance: out.balance,
      required: config.CREDIT_PER_CHAT,
    });
    return;
  }

  res.status(200).json({
    ok: true,
    balance: out.newBalance,
    reply:
      "Cookbook chat stub — the LLM call lands in AC-5; this response just confirms the credit deduction.",
    note: "AC-5 will replace the reply with a real LLM-generated answer and write a chat_log row.",
  });
});
