// HTTP routes for the Brainstorming-skill-driven prompt generator.
//
//   POST /api/prompt/start   { track?, freeText?, locale? }
//                             -> { sessionId, question, step:0, stepName:"INTENT" }
//
//   POST /api/prompt/answer  { sessionId, answer }
//                             -> { question?, step, stepName, done? }
//                             or on DONE: { done:true, prompt, sections, rubricChecklist, track }
//
// Credit accounting (AC-6 mirrors AC-4):
//   - /api/prompt/start is FREE — the first question is a fixed
//     Socratic seed, no LLM call.
//   - /api/prompt/answer deducts 20 credits ONLY on successful
//     LLM transitions. On LlmError the route refunds the 20 credits
//     via recordGrant so the user isn't billed for a broken call,
//     and responds 502 with a sanitized body (never leaks the key).
//   - 402 on insufficient balance; the session state is preserved
//     so the user can retry after the next vote grant or top-up.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { tryDeduct, recordGrant } from "../services/credits.js";
import { config } from "../config.js";
import {
  start as bsStart,
  answer as bsAnswer,
  BrainstormingError,
  TRACKS,
  type BrainstormingLocale,
  type Track,
} from "../services/brainstorming.js";
import {
  safeLlmErrorResponse,
  LlmError,
} from "../services/llm.js";

const StartSchema = z.object({
  track: z
    .enum(TRACKS)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? null : v)),
  freeText: z.string().min(1).max(2000).optional(),
  locale: z.enum(["en", "zh"]).optional(),
});

const AnswerSchema = z.object({
  sessionId: z.string().min(1),
  answer: z.string().min(1).max(4000),
});

export const promptRouter = Router();

promptRouter.post("/start", async (req: Request, res: Response) => {
  const parsed = StartSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_body",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const locale: BrainstormingLocale = parsed.data.locale ?? "en";
  const track: Track | null = parsed.data.track ?? null;

  try {
    const out = await bsStart({ track, freeText: parsed.data.freeText, locale });
    res.status(200).json(out);
  } catch (err) {
    // bsStart is in-process and doesn't throw on the happy path;
    // surface anything unexpected as a 500.
    // eslint-disable-next-line no-console
    console.error("[prompt.start] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

promptRouter.post("/answer", async (req: Request, res: Response) => {
  const parsed = AnswerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_body",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  // 1) Pre-check the balance so we can short-circuit to 402 BEFORE
  //    calling the LLM (avoids burning an upstream call for users
  //    who can't pay).
  const ref = `prompt:${parsed.data.sessionId.slice(0, 8)}:answer`;
  const out = tryDeduct(config.CREDIT_PER_CHAT, "prompt", ref);
  if (!out.ok) {
    res.status(402).json({
      error: "insufficient_credits",
      balance: out.balance,
      required: config.CREDIT_PER_CHAT,
    });
    return;
  }

  // 2) Call the brainstorming service. On LlmError, refund the
  //    20 credits so failed calls don't deduct.
  try {
    const result = await bsAnswer({
      sessionId: parsed.data.sessionId,
      answer: parsed.data.answer,
    });
    res.status(200).json({
      ...result,
      balance: out.newBalance,
    });
  } catch (err) {
    // Refund. Refs make the deduction+refund pair reconcilable.
    recordGrant(
      config.CREDIT_PER_CHAT,
      "prompt-refund",
      `${ref}:refund`,
    );

    if (err instanceof BrainstormingError) {
      res.status(err.httpStatus).json({ error: err.code });
      return;
    }
    if (err instanceof LlmError) {
      const safe = safeLlmErrorResponse(err);
      // eslint-disable-next-line no-console
      console.warn(
        `[prompt.answer] llm call failed (${err.httpStatus}); ` +
          `refunded ${config.CREDIT_PER_CHAT} credits to session ${parsed.data.sessionId}`,
      );
      res.status(safe.status).json(safe.body);
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[prompt.answer] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
});
