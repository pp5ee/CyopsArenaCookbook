// Ideas route — Quick generation + streaming chat for project ideas.
//
//   POST /api/ideas/quick       → One-shot AI generates a complete project idea
//   POST /api/ideas/chat-stream → SSE streaming chat with brainstorming flow
//
// Both endpoints deduct 20 credits and refund on LLM failure.

import { Router } from "express";
import { z } from "zod";
import { chat, chatStream, LlmError, safeLlmErrorResponse } from "../services/llm.js";
import { tryDeduct, recordGrant, getBalance } from "../services/credits.js";
import { randomUUID } from "node:crypto";
import { start as bsStart, answer as bsAnswer, type BrainstormingLocale } from "../services/brainstorming.js";

export const ideasRouter = Router();

/* ------------------------------------------------------------------ */
/*  POST /api/ideas/quick — One-shot idea generation                  */
/* ------------------------------------------------------------------ */

const QuickBody = z.object({
  idea: z.string().max(2000).optional(),
  locale: z.enum(["en", "zh"]).optional().default("en"),
});

const QUICK_SYSTEM_PROMPT = `You are an expert hackathon mentor for the CyOpsxMinimax hackathon. Your job is to generate a complete, actionable project idea that a participant can immediately build.

The hackathon has 4 tracks:
- ship-a-feature: Close a real GitHub issue with a working PR
- mcp-server: Build a useful MCP server for developer workflows
- whole-repo-refactor: Modernize/migrate/clean up a real codebase
- resurrection: Revive an abandoned or broken project

CyOps is an AI-powered development platform that can auto-generate projects from prompts.

You MUST respond in the user's locale. Output ONLY valid JSON — no markdown, no preamble.

Generate a project idea that is:
1. Feasible to build in a hackathon timeframe
2. Aligned with current web/AI development trends
3. Specific enough to generate useful prompts for CyOps

Output shape:
{
  "projectTitle": "Catchy project name",
  "track": "ship-a-feature" | "mcp-server" | "whole-repo-refactor" | "resurrection",
  "tagline": "One-line elevator pitch",
  "problem": "What problem does it solve? (2-3 sentences)",
  "targetUsers": "Who is this for? (1-2 sentences)",
  "solution": "How does it solve the problem? (2-3 sentences)",
  "techStack": ["React", "Node.js", "..."],
  "keyFeatures": ["Feature 1", "Feature 2", "Feature 3"],
  "uiDesignPrompt": "A concise prompt for CyOps to generate the UI. Include layout, color scheme, key screens. Can reference image URLs.",
  "backendDesignPrompt": "A concise prompt for CyOps to generate the backend. Include API design, data model, key endpoints.",
  "sources": [
    {"title": "Source title", "url": "https://...", "relevance": "Why this is relevant"}
  ]
}

Keep all prompts CONCISE (under 300 words each). Include image/link references where helpful.`;

ideasRouter.post("/quick", async (req, res) => {
  try {
    const body = QuickBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_body", message: body.error.issues.map(i => i.message).join(", ") });
      return;
    }

    const { idea, locale } = body.data;
    const sessionId = randomUUID();

    // Deduct credits
    const deduct = tryDeduct(20, "quick-idea", sessionId);
    if (!deduct.ok) {
      res.status(402).json({
        error: "insufficient_credits",
        message: "Not enough credits. The pool is shared — try again after the next vote grant.",
        balance: deduct.balance,
        required: 20,
      });
      return;
    }

    const userMessage = idea
      ? `Generate a hackathon project idea based on this concept: "${idea}". Respond in ${locale === "zh" ? "Chinese" : "English"}.`
      : `Generate a fresh, trending hackathon project idea. Consider current web dev and AI trends (June 2026). Respond in ${locale === "zh" ? "Chinese" : "English"}.`;

    try {
      const reply = await chat(
        [
          { role: "system", content: QUICK_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        { sessionId, temperature: 0.8 },
      );

      // Extract JSON from the response
      let parsed: QuickIdeaOutput;
      try {
        const trimmed = reply.content.trim();
        const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
        const jsonStr = fence?.[1]?.trim()
          ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
        parsed = JSON.parse(jsonStr) as QuickIdeaOutput;
      } catch {
        // If JSON parsing fails, return the raw text as the idea
        parsed = {
          projectTitle: "Generated Idea",
          track: "ship-a-feature",
          tagline: reply.content.slice(0, 120),
          problem: reply.content,
          targetUsers: "Hackathon participants",
          solution: "See full generation above",
          techStack: [],
          keyFeatures: [],
          uiDesignPrompt: "",
          backendDesignPrompt: "",
          sources: [],
        };
      }

      res.json({
        ok: true,
        project: parsed,
        balance: deduct.newBalance,
      });
    } catch (err) {
      // Refund on LLM failure
      recordGrant(20, "quick-idea-refund", sessionId);
      const safe = safeLlmErrorResponse(err);
      res.status(safe.status).json(safe.body);
    }
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: "Unexpected error" });
  }
});

interface QuickIdeaOutput {
  projectTitle: string;
  track: string;
  tagline: string;
  problem: string;
  targetUsers: string;
  solution: string;
  techStack: string[];
  keyFeatures: string[];
  uiDesignPrompt: string;
  backendDesignPrompt: string;
  sources: { title: string; url: string; relevance: string }[];
}

/* ------------------------------------------------------------------ */
/*  POST /api/ideas/chat-stream — SSE streaming chat quiz             */
/* ------------------------------------------------------------------ */

const ChatStreamBody = z.object({
  sessionId: z.string().optional(),
  answer: z.string().max(4000).optional(),
  track: z.enum(["ship-a-feature", "mcp-server", "whole-repo-refactor", "resurrection"]).optional(),
  locale: z.enum(["en", "zh"]).optional().default("en"),
  freeText: z.string().max(2000).optional(),
});

ideasRouter.post("/chat-stream", async (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const body = ChatStreamBody.safeParse(req.body);
    if (!body.success) {
      send({ error: "invalid_body", message: body.error.issues.map(i => i.message).join(", ") });
      res.end();
      return;
    }

    const { sessionId, answer, track, locale, freeText } = body.data;
    const sid = sessionId ?? randomUUID();
    const loc: BrainstormingLocale = locale === "zh" ? "zh" : "en";

    // Deduct credits
    const deduct = tryDeduct(20, "chat-stream", sid);
    if (!deduct.ok) {
      send({
        error: "insufficient_credits",
        message: "Not enough credits. The pool is shared.",
        balance: deduct.balance,
      });
      send({ done: true, balance: deduct.balance });
      res.end();
      return;
    }

    try {
      if (!sessionId) {
        // New session — start brainstorming
        const started = await bsStart({ track: track ?? null, freeText: freeText ?? undefined, locale: loc });
        send({
          type: "started",
          sessionId: started.sessionId,
          question: started.question,
          step: started.step,
          stepName: started.stepName,
          balance: deduct.newBalance,
        });
        send({ done: true, balance: deduct.newBalance });
        res.end();
        return;
      }

      if (!answer) {
        send({ error: "answer_required", message: "Provide an answer to continue." });
        send({ done: true, balance: deduct.newBalance });
        res.end();
        return;
      }

      // Continue brainstorming with the answer
      const result = await bsAnswer({ sessionId: sid, answer });

      if (result.done) {
        send({
          type: "done",
          prompt: result.prompt,
          sections: result.sections,
          rubricChecklist: result.rubricChecklist,
          track: result.track,
          balance: deduct.newBalance,
        });
      } else {
        send({
          type: "question",
          sessionId: result.sessionId,
          question: result.question,
          step: result.step,
          stepName: result.stepName,
          balance: deduct.newBalance,
        });
      }
      send({ done: true, balance: deduct.newBalance });
    } catch (err) {
      recordGrant(20, "chat-stream-refund", sid);
      if (err instanceof LlmError) {
        send({ error: "llm_error", message: "AI call failed. Credits refunded." });
      } else {
        send({ error: "brainstorming_error", message: (err as Error).message });
      }
    }
  } catch (err) {
    send({ error: "internal_error", message: "Unexpected error" });
  } finally {
    res.end();
  }
});
