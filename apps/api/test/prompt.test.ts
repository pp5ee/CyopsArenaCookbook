// AC-6 tests: start → ≥3 answers → DONE; the final prompt must
// carry the rubric checklist with the six dimensions and weights
// 20/16/20/16/20/8. We mock the LLM service per-test so the suite
// is hermetic and the assertions are deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDb, openDb, getDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

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
const {
  start: bsStart,
  answer: bsAnswer,
  loadSkill,
  clearSessions,
  TRACKS,
} = await import("../src/services/brainstorming.js");
const { __test } = await import("../src/services/brainstorming.js");

function okJson(content: object) {
  return {
    content: JSON.stringify(content),
    model: "gpt-4o-mini",
    tokensIn: 1,
    tokensOut: 1,
    latencyMs: 0,
  };
}

function okQuestion(q: string) {
  return okJson({ question: q });
}

function okFinal(overrides: Record<string, unknown> = {}) {
  return okJson({
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
    ...overrides,
  });
}

describe("brainstorming service (AC-6)", () => {
  let workDir: string;
  let dbFile: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "cookbook-bs-"));
    dbFile = join(workDir, "bs.sqlite");
    setDb(openDb(dbFile));
    runMigrations();
    seed();
    vi.mocked(llmChat).mockReset();
    clearSessions();
  });

  afterEach(() => {
    setDb(null);
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("loadSkill", () => {
    it("returns the cached skill text (non-empty)", () => {
      const s = loadSkill();
      expect(s.length).toBeGreaterThan(100);
      expect(s).toMatch(/brainstorming/i);
    });
  });

  describe("start", () => {
    it("returns the Socratic first question (en) at step 0 with a fresh sessionId", async () => {
      const out = await bsStart({ track: "ship-a-feature", locale: "en" });
      expect(out.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(out.step).toBe(0);
      expect(out.stepName).toBe("INTENT");
      expect(out.question.length).toBeGreaterThan(0);
      expect(out.question).toMatch(/user/i);
    });

    it("returns the localized first question (zh) when locale='zh'", async () => {
      const out = await bsStart({ track: null, locale: "zh" });
      expect(out.step).toBe(0);
      // CJK characters expected.
      expect(out.question).toMatch(/[一-龥]/);
    });

    it("honors locale='en' explicitly (no fallback to zh)", async () => {
      const out = await bsStart({ track: null, locale: "en" });
      // The English first question starts with "What" — never a CJK char.
      expect(out.question).toMatch(/^What/);
      expect(out.question).not.toMatch(/[一-龥]/);
    });
  });

  describe("answer (happy path: INTENT → ... → DONE)", () => {
    it("walks the full state machine in 6 answers and emits the rubric checklist", async () => {
      // Mock the LLM with a stub that returns a sensible
      // follow-up question for steps 1..5, then a final JSON for
      // step 6 (DONE).
      const followUps = [
        "Q2: Who is the target user?",
        "Q3: What constraints matter?",
        "Q4: What are 2-3 approaches?",
        "Q5: Sketch the design components.",
        "Q6: What is the riskiest assumption?",
      ];
      let call = 0;
      vi.mocked(llmChat).mockImplementation(async () => {
        const idx = call++;
        if (idx < followUps.length) return okQuestion(followUps[idx]!);
        return okFinal();
      });

      const s0 = await bsStart({ track: "ship-a-feature", locale: "en" });
      expect(s0.stepName).toBe("INTENT");

      const a1 = await bsAnswer({ sessionId: s0.sessionId, answer: "Build a thing" });
      expect(a1.stepName).toBe("CONTEXT");
      expect(a1.question).toBe(followUps[0]);

      const a2 = await bsAnswer({ sessionId: s0.sessionId, answer: "Hackathon folks" });
      expect(a2.stepName).toBe("CONSTRAINTS");

      const a3 = await bsAnswer({ sessionId: s0.sessionId, answer: "Time-boxed, JS only" });
      expect(a3.stepName).toBe("APPROACHES");

      const a4 = await bsAnswer({ sessionId: s0.sessionId, answer: "Two viable approaches" });
      expect(a4.stepName).toBe("DESIGN");

      const a5 = await bsAnswer({ sessionId: s0.sessionId, answer: "Architecture agreed" });
      expect(a5.stepName).toBe("REFINE");

      const a6 = await bsAnswer({ sessionId: s0.sessionId, answer: "Riskiest is X" });
      expect(a6.done).toBe(true);
      expect(a6.stepName).toBe("DONE");
      expect(a6.sections).toBeDefined();
      expect(a6.rubricChecklist).toEqual({
        implementation_engineering_quality: 20,
        architecture_complexity_fit: 16,
        deliverable_completeness: 20,
        project_copy_documentation: 16,
        ai_agent_integration: 20,
        implementation_innovation: 8,
      });
      expect(a6.track).toBe("ship-a-feature");
      // Rendered prompt must contain the rubric weights verbatim.
      expect(a6.prompt).toContain("implementation_engineering_quality: 20");
      expect(a6.prompt).toContain("architecture_complexity_fit: 16");
      expect(a6.prompt).toContain("deliverable_completeness: 20");
      expect(a6.prompt).toContain("project_copy_documentation: 16");
      expect(a6.prompt).toContain("ai_agent_integration: 20");
      expect(a6.prompt).toContain("implementation_innovation: 8");
      expect(a6.prompt).toMatch(/^---\ntrack: ship-a-feature/);
      // Persisted to prompt_draft.
      const rows = getDb()
        .prepare("SELECT track, prompt FROM prompt_draft")
        .all() as { track: string; prompt: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.track).toBe("ship-a-feature");
      expect(rows[0]!.prompt).toContain("## Problem");
    });
  });

  describe("answer (failure paths)", () => {
    it("propagates LlmError (the route handles refund + sanitization)", async () => {
      vi.mocked(llmChat).mockRejectedValue(new LlmError("upstream down", 502));
      const s0 = await bsStart({ track: null, locale: "en" });
      await expect(
        bsAnswer({ sessionId: s0.sessionId, answer: "x" }),
      ).rejects.toBeInstanceOf(LlmError);
    });

    it("throws BrainstormingError(404) for an unknown sessionId", async () => {
      await expect(
        bsAnswer({ sessionId: "does-not-exist", answer: "x" }),
      ).rejects.toMatchObject({ code: "session_not_found", httpStatus: 404 });
    });

    it("throws BrainstormingError(400) for an empty answer", async () => {
      const s0 = await bsStart({ track: null, locale: "en" });
      await expect(
        bsAnswer({ sessionId: s0.sessionId, answer: "   " }),
      ).rejects.toMatchObject({ code: "empty_answer", httpStatus: 400 });
    });

    it("extractJson tolerates a markdown-fenced JSON response", () => {
      // Internal helper: verify it strips code fences.
      const schema = z.object({ question: z.string().min(1) });
      const wrapped = '```json\n{"question":"hi"}\n```';
      const out = __test.extractJson(wrapped, schema);
      expect(out.question).toBe("hi");
    });
  });

  describe("answer (locale propagation to the LLM)", () => {
    it("includes the chosen locale in the system prompt so the LLM responds in that locale", async () => {
      let capturedSystem = "";
      let callCount = 0;
      vi.mocked(llmChat).mockImplementation(async (messages) => {
        callCount += 1;
        // The first message is the system prompt. Capture it.
        const sys = (messages as { role: string; content: string }[]).find(
          (m) => m.role === "system",
        );
        if (sys) capturedSystem = sys.content;
        return okQuestion("Q?");
      });
      const s0 = await bsStart({ track: null, locale: "zh" });
      await bsAnswer({ sessionId: s0.sessionId, answer: "hello" });
      expect(callCount).toBeGreaterThan(0);
      // The system prompt must include the locale directive.
      expect(capturedSystem).toMatch(/locale is "zh"/);
      expect(capturedSystem).toMatch(/Respond in that locale/);
    });

    it("includes the en locale in the system prompt when locale='en'", async () => {
      let capturedSystem = "";
      vi.mocked(llmChat).mockImplementation(async (messages) => {
        const sys = (messages as { role: string; content: string }[]).find(
          (m) => m.role === "system",
        );
        if (sys) capturedSystem = sys.content;
        return okQuestion("Q?");
      });
      const s0 = await bsStart({ track: null, locale: "en" });
      await bsAnswer({ sessionId: s0.sessionId, answer: "hello" });
      expect(capturedSystem).toMatch(/locale is "en"/);
    });
  });

  describe("answer (locale propagation to the LLM)", () => {
    it("includes the chosen locale in the system prompt so the LLM responds in that locale", async () => {
      let capturedSystem = "";
      let callCount = 0;
      vi.mocked(llmChat).mockImplementation(async (messages) => {
        callCount += 1;
        // The first message is the system prompt. Capture it.
        const sys = (messages as { role: string; content: string }[]).find(
          (m) => m.role === "system",
        );
        if (sys) capturedSystem = sys.content;
        return okQuestion("Q?");
      });
      const s0 = await bsStart({ track: null, locale: "zh" });
      await bsAnswer({ sessionId: s0.sessionId, answer: "hello" });
      expect(callCount).toBeGreaterThan(0);
      // The system prompt must include the locale directive.
      expect(capturedSystem).toMatch(/locale is "zh"/);
      expect(capturedSystem).toMatch(/Respond in that locale/);
    });

    it("includes the en locale in the system prompt when locale='en'", async () => {
      let capturedSystem = "";
      vi.mocked(llmChat).mockImplementation(async (messages) => {
        const sys = (messages as { role: string; content: string }[]).find(
          (m) => m.role === "system",
        );
        if (sys) capturedSystem = sys.content;
        return okQuestion("Q?");
      });
      const s0 = await bsStart({ track: null, locale: "en" });
      await bsAnswer({ sessionId: s0.sessionId, answer: "hello" });
      expect(capturedSystem).toMatch(/locale is "en"/);
    });
  });

  describe("answer (JSON extraction tolerance)", () => {
    it("accepts a markdown-fenced JSON in the DONE step", async () => {
      let call = 0;
      vi.mocked(llmChat).mockImplementation(async () => {
        call += 1;
        if (call <= 5) return okQuestion(`follow-up ${call}`);
        // DONE step: model wraps the JSON in a code fence.
        return {
          content: "```json\n" + JSON.stringify({
            project_title: "X",
            track: "resurrection",
            target_audience: "y",
            success_criteria: ["a"],
            rubric_checklist: {
              implementation_engineering_quality: 20,
              architecture_complexity_fit: 16,
              deliverable_completeness: 20,
              project_copy_documentation: 16,
              ai_agent_integration: 20,
              implementation_innovation: 8,
            },
            sections: {
              problem: "p",
              users: "u",
              solution: "s",
              approach: "a",
              tradeoffs: "t",
              scorecard: "c",
            },
          }) + "\n```",
          model: "gpt-4o-mini",
          tokensIn: 1,
          tokensOut: 1,
          latencyMs: 0,
        };
      });
      const s0 = await bsStart({ track: null, locale: "en" });
      for (let i = 0; i < 6; i++) {
        await bsAnswer({ sessionId: s0.sessionId, answer: `a${i}` });
      }
      const last = await bsAnswer({ sessionId: s0.sessionId, answer: "last" });
      expect(last.done).toBe(true);
      expect(last.track).toBe("resurrection");
    });

    it("rejects (502) when the DONE step's JSON is malformed", async () => {
      let call = 0;
      vi.mocked(llmChat).mockImplementation(async () => {
        call += 1;
        if (call <= 5) return okQuestion(`follow-up ${call}`);
        return {
          content: "not json at all",
          model: "gpt-4o-mini",
          tokensIn: 1,
          tokensOut: 1,
          latencyMs: 0,
        };
      });
      const s0 = await bsStart({ track: null, locale: "en" });
      // The DONE step is reached on the 6th answer. The mock returns
      // malformed content for the DONE call, so bsAnswer throws.
      let caught: unknown = null;
      for (let i = 0; i < 6; i++) {
        try {
          await bsAnswer({ sessionId: s0.sessionId, answer: `a${i}` });
        } catch (e) {
          if (i < 5) throw e; // re-throw unexpected errors from non-DONE steps
          caught = e;
        }
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/llm_json_invalid/);
    });
  });
});
