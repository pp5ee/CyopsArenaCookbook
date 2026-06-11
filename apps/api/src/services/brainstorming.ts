// Brainstorming skill state machine.
//
// Drives the prompt generator through a Socratic interview that ends
// in a CyOps-ready prompt block. The state machine is:
//
//   INTENT → CONTEXT → CONSTRAINTS → APPROACHES → DESIGN → REFINE → DONE
//
// Each transition is ONE LLM call. The system prompt includes:
//   - the cached brainstorming skill text (so the LLM stays on-skill),
//   - the running transcript of {question, answer} pairs,
//   - the chosen track (if any),
//   - the rubric weights (for the DONE step).
//
// The DONE transition is forced to emit JSON that matches a zod
// schema; the JSON is then wrapped into the CyOps prompt format
// (front-matter + Markdown body with the six rubric sections).
//
// Public surface (AC-6):
//   - start({ track?, freeText?, locale }) -> { sessionId, question, step:0 }
//   - answer({ sessionId, answer })       -> { question?, step, done? }
//                                              or on DONE: { done:true, prompt, sections, rubric_checklist }
//   - loadSkill() -> string (used by tests + the route's /api/prompt/*)

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getDb } from "../db/connection.js";
import { config } from "../config.js";
import { chat as llmChat, LlmError } from "./llm.js";

const PKG_ROOT = dirname(fileURLToPath(import.meta.url));
const CACHED_SKILL = join(PKG_ROOT, "brainstorming-skill.md");
const EMBEDDED_SKILL = join(PKG_ROOT, "brainstorming-skill.embedded.md");

/* ------------------------------------------------------------------ */
/*  Public types and zod schemas                                      */
/* ------------------------------------------------------------------ */

export type BrainstormingLocale = "en" | "zh";

export const TRACKS = [
  "ship-a-feature",
  "mcp-server",
  "whole-repo-refactor",
  "resurrection",
] as const;
export type Track = (typeof TRACKS)[number];

export const STEPS = [
  "INTENT",
  "CONTEXT",
  "CONSTRAINTS",
  "APPROACHES",
  "DESIGN",
  "REFINE",
  "DONE",
] as const;
export type Step = (typeof STEPS)[number];

const STEP_INDEX: Record<Step, number> = {
  INTENT: 0,
  CONTEXT: 1,
  CONSTRAINTS: 2,
  APPROACHES: 3,
  DESIGN: 4,
  REFINE: 5,
  DONE: 6,
};

export const RubricChecklistSchema = z.object({
  implementation_engineering_quality: z.literal(20),
  architecture_complexity_fit: z.literal(16),
  deliverable_completeness: z.literal(20),
  project_copy_documentation: z.literal(16),
  ai_agent_integration: z.literal(20),
  implementation_innovation: z.literal(8),
});
export type RubricChecklist = z.infer<typeof RubricChecklistSchema>;

export const PromptSectionsSchema = z.object({
  problem: z.string().min(1),
  users: z.string().min(1),
  solution: z.string().min(1),
  approach: z.string().min(1),
  tradeoffs: z.string().min(1),
  scorecard: z.string().min(1),
});
export type PromptSections = z.infer<typeof PromptSectionsSchema>;

export const FinalPromptSchema = z.object({
  project_title: z.string().min(1),
  track: z.enum(TRACKS),
  target_audience: z.string().min(1),
  success_criteria: z.array(z.string().min(1)).min(1).max(8),
  rubric_checklist: RubricChecklistSchema,
  sections: PromptSectionsSchema,
});

/* ------------------------------------------------------------------ */
/*  Skill loader                                                      */
/* ------------------------------------------------------------------ */

/** Return the cached skill text. Falls back to the embedded copy. */
export function loadSkill(): string {
  try {
    if (existsSync(CACHED_SKILL)) {
      return readFileSync(CACHED_SKILL, "utf8");
    }
  } catch {
    /* fallthrough */
  }
  try {
    return readFileSync(EMBEDDED_SKILL, "utf8");
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/*  Per-step question templates                                       */
/* ------------------------------------------------------------------ */

/** Static, hand-written first questions for the early steps. They
 *  are the "what is the user actually trying to do?" Socratic seed
 *  from the brainstorming skill. The LLM generates follow-up
 *  questions for later steps based on the transcript. */
const FIRST_QUESTIONS: Record<Exclude<Step, "DONE">, Record<BrainstormingLocale, string>> = {
  INTENT: {
    en: "What is the user actually trying to do? Describe the concrete outcome in one or two sentences.",
    zh: "用户真正想完成的是什么？用一两句话描述具体的结果。",
  },
  CONTEXT: {
    en: "Who is the target user for this project, and what problem does it solve for them today?",
    zh: "这个项目的目标用户是谁？它今天为他们解决了什么问题？",
  },
  CONSTRAINTS: {
    en: "What constraints matter (time, platform, language, dependencies, team size)? Are there constraints that would rule out a whole class of solutions?",
    zh: "有哪些关键约束（时间、平台、语言、依赖、团队规模）？哪些约束会直接排除一整类方案？",
  },
  APPROACHES: {
    en: "What 2-3 different approaches could solve this? Briefly note the trade-off for each and which you would recommend and why.",
    zh: "有哪些 2-3 种不同的方案可以解决？简要列出每种方案的取舍，并说明你推荐哪一种以及理由。",
  },
  DESIGN: {
    en: "Sketch the design: what are the major components, how do they communicate, and where does state live?",
    zh: "画出设计：有哪些主要组件，它们如何通信，状态存放在哪里？",
  },
  REFINE: {
    en: "What is the riskiest assumption in this design? How would you test or de-risk it before committing to implementation?",
    zh: "这个设计中风险最高的假设是什么？在投入实现之前，你要如何测试或降低这个风险？",
  },
};

const STEP_FOLLOWUP_INSTRUCTIONS: Record<Exclude<Step, "DONE">, string> = {
  INTENT:
    "Ask the user to clarify the core intent. One question only. Prefer multiple choice. Do not propose a design yet.",
  CONTEXT:
    "Ask the user to clarify the user/context. One question only. Prefer multiple choice. Do not propose a design yet.",
  CONSTRAINTS:
    "Ask the user to clarify the hard constraints. One question only. Prefer multiple choice. Do not propose a design yet.",
  APPROACHES:
    "Propose 2-3 alternative approaches with a one-line trade-off each. Recommend one and explain why. Do NOT present a full design yet.",
  DESIGN:
    "Present the design in 4-6 short sections (architecture, components, data flow, error handling, testing). Ask for approval after each section in the same turn if the user wants to iterate. Stay at the design level — no implementation steps.",
  REFINE:
    "Ask the user about the riskiest assumption in the agreed design and how to de-risk it. One question only.",
};

function systemPrompt(
  step: Step,
  track: Track | null,
  locale: BrainstormingLocale,
  transcript: { question: string; answer: string }[],
): string {
  const skill = loadSkill();
  const rubricBlock = `
Rubric weights (must appear verbatim in the DONE prompt's rubric_checklist):
  implementation_engineering_quality: 20
  architecture_complexity_fit: 16
  deliverable_completeness: 20
  project_copy_documentation: 16
  ai_agent_integration: 20
  implementation_innovation: 8
`;
  const trackLine = track
    ? `The user has pre-selected the track: "${track}". Do not ask which track.`
    : `No track pre-selected; if the user's idea doesn't map to a track, leave track: null in the final JSON (the route will pick a default).`;

  const base = `You are running the upstream "brainstorming" skill (obra/superpowers) on behalf of a CyOpsxMinimax hackathon participant.
Your job is to ask Socratic questions ONE AT A TIME and, at the DONE step, emit a JSON object that the route will wrap into a CyOps prompt.

# Skill text (cached)

${skill}

# Locale

The user's chosen locale is "${locale}". Respond in that locale.

# Track

${trackLine}

# Rubric

${rubricBlock}

# Current step

${step}

# Step instructions

${step === "DONE" ? DONE_INSTRUCTIONS : STEP_FOLLOWUP_INSTRUCTIONS[step]}

# Transcript so far

${
  transcript.length === 0
    ? "(none yet)"
    : transcript
        .map(
          (qa, i) =>
            `${i + 1}. Q: ${qa.question}\n   A: ${qa.answer}`,
        )
        .join("\n")
}

# Output format

${step === "DONE" ? DONE_OUTPUT_FORMAT : QUESTION_OUTPUT_FORMAT}
`;

  return base;
}

const QUESTION_OUTPUT_FORMAT = `Return a single JSON object with this exact shape, no prose, no markdown fences:
{"question": "<one concise question in the user's locale>"}`;

const DONE_INSTRUCTIONS = `You have enough information. Synthesize the transcript into a final design and emit ONLY a JSON object matching the schema below. No prose, no markdown fences, no preamble. The route will wrap the JSON into a CyOps prompt.

The JSON MUST validate against this shape:
{
  "project_title": "<short project title>",
  "track": "ship-a-feature" | "mcp-server" | "whole-repo-refactor" | "resurrection",
  "target_audience": "<one sentence>",
  "success_criteria": ["<criterion 1>", "<criterion 2>", ...],   // 3-6 items
  "rubric_checklist": {
    "implementation_engineering_quality": 20,
    "architecture_complexity_fit": 16,
    "deliverable_completeness": 20,
    "project_copy_documentation": 16,
    "ai_agent_integration": 20,
    "implementation_innovation": 8
  },
  "sections": {
    "problem":     "<1-2 sentences>",
    "users":       "<1-2 sentences>",
    "solution":    "<2-3 sentences>",
    "approach":    "<2-3 sentences>",
    "tradeoffs":   "<2-3 sentences>",
    "scorecard":   "<1 sentence per rubric dimension, naming the strongest and weakest>"
  }
}`;

const DONE_OUTPUT_FORMAT = DONE_INSTRUCTIONS;

/* ------------------------------------------------------------------ */
/*  Session storage (in-memory; the route persists the final draft)  */
/* ------------------------------------------------------------------ */

interface Session {
  id: string;
  track: Track | null;
  locale: BrainstormingLocale;
  transcript: { question: string; answer: string }[];
  createdAt: number;
}

const SESSIONS = new Map<string, Session>();

export function getSession(id: string): Session | undefined {
  return SESSIONS.get(id);
}

export function clearSessions(): void {
  SESSIONS.clear();
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface StartInput {
  track?: Track | null;
  freeText?: string;
  locale?: BrainstormingLocale;
}

export interface StartOutput {
  sessionId: string;
  question: string;
  step: number;
  stepName: Step;
}

export async function start(input: StartInput): Promise<StartOutput> {
  const locale: BrainstormingLocale = input.locale === "zh" ? "zh" : "en";
  const track = input.track ?? null;
  const id = randomUUID();
  const session: Session = {
    id,
    track,
    locale,
    transcript: [],
    createdAt: Date.now(),
  };
  SESSIONS.set(id, session);

  // The first question is the hand-written Socratic seed for the
  // INTENT step. The LLM gets to ask follow-ups starting at CONTEXT.
  const seedQuestion = FIRST_QUESTIONS.INTENT[locale];
  session.transcript.push({ question: seedQuestion, answer: "" });

  // We do NOT call the LLM on start — the first question is fixed
  // and the plan says "the first question is the Socratic 'what is
  // the user actually trying to do?' question from the skill." This
  // also keeps /api/prompt/start fast and free of credit cost.
  return {
    sessionId: id,
    question: seedQuestion,
    step: STEP_INDEX.INTENT,
    stepName: "INTENT",
  };
}

export interface AnswerInput {
  sessionId: string;
  answer: string;
}

export interface AnswerOutput {
  sessionId: string;
  step: number;
  stepName: Step;
  question?: string;
  done?: boolean;
  prompt?: string;
  sections?: PromptSections;
  rubricChecklist?: RubricChecklist;
  track?: Track;
}

export async function answer(input: AnswerInput): Promise<AnswerOutput> {
  const session = SESSIONS.get(input.sessionId);
  if (!session) {
    throw new BrainstormingError("session_not_found", 404);
  }
  if (typeof input.answer !== "string" || input.answer.trim().length === 0) {
    throw new BrainstormingError("empty_answer", 400);
  }

  // Stamp the last pending question with the user's answer.
  const last = session.transcript[session.transcript.length - 1];
  if (last && last.answer === "") {
    last.answer = input.answer.trim();
  } else {
    // Defensive: in case start() was bypassed.
    session.transcript.push({ question: "(user-supplied)", answer: input.answer.trim() });
  }

  // Decide the next step.
  const lastStepName = currentStepName(session);
  if (lastStepName === "DONE") {
    return { sessionId: session.id, step: 6, stepName: "DONE", done: true };
  }

  // Charge 20 credits for the LLM call. The route is responsible
  // for refunding on LlmError; the service just throws and lets
  // the caller (route) decide.
  const nextStep = advanceStep(lastStepName);
  const transcript = session.transcript.slice(0, -1); // exclude the in-flight entry
  const sys = systemPrompt(nextStep, session.track, session.locale, transcript);

  try {
    if (nextStep === "DONE") {
      const parsed = await runDoneStep(sys, session);
      persistDraft(session, parsed);
      return {
        sessionId: session.id,
        step: STEP_INDEX.DONE,
        stepName: "DONE",
        done: true,
        prompt: parsed.prompt,
        sections: parsed.sections,
        rubricChecklist: parsed.rubricChecklist,
        track: parsed.track,
      };
    }

    const followUp = await runQuestionStep(sys, session);
    session.transcript.push({ question: followUp, answer: "" });
    return {
      sessionId: session.id,
      step: STEP_INDEX[nextStep],
      stepName: nextStep,
      question: followUp,
    };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Internals                                                         */
/* ------------------------------------------------------------------ */

export class BrainstormingError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, httpStatus: number) {
    super(code);
    this.name = "BrainstormingError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function currentStepName(session: Session): Step {
  // The "current" step is the one the user has just answered (or
  // is about to answer, before any answer lands). After 0 answers
  // the current step is INTENT (the seed question). After N
  // answers the current step is the Nth step in the order
  // INTENT→CONTEXT→CONSTRAINTS→APPROACHES→DESIGN→REFINE. After 6
  // answers the current step is REFINE and `advanceStep()` returns
  // DONE.
  const answered = session.transcript.filter((qa) => qa.answer !== "").length;
  const order: Step[] = [
    "INTENT",
    "CONTEXT",
    "CONSTRAINTS",
    "APPROACHES",
    "DESIGN",
    "REFINE",
  ];
  if (answered <= 0) return "INTENT";
  const idx = Math.min(answered - 1, order.length - 1);
  return order[idx]!;
}

function advanceStep(current: Step): Step {
  const order: Step[] = [
    "INTENT",
    "CONTEXT",
    "CONSTRAINTS",
    "APPROACHES",
    "DESIGN",
    "REFINE",
    "DONE",
  ];
  const i = order.indexOf(current);
  if (i < 0 || i === order.length - 1) return "DONE";
  return order[i + 1]!;
}

const QuestionJsonSchema = z.object({ question: z.string().min(1) });

async function runQuestionStep(sys: string, session: Session): Promise<string> {
  const reply = await llmChat(
    [
      { role: "system", content: sys },
      // Seed the model with the transcript so it has context.
      ...session.transcript
        .filter((qa) => qa.answer !== "")
        .map<{ role: "user" | "assistant"; content: string }>((qa, i) => ({
          role: i % 2 === 0 ? "assistant" : "user",
          content: i % 2 === 0 ? qa.question : qa.answer,
        })),
    ],
    { sessionId: `brainstorm:${session.id}`, temperature: 0.6 },
  );
  return extractJson(reply.content, QuestionJsonSchema).question;
}

interface DoneResult {
  prompt: string;
  sections: PromptSections;
  rubricChecklist: RubricChecklist;
  track: Track;
}

async function runDoneStep(sys: string, session: Session): Promise<DoneResult> {
  const reply = await llmChat(
    [
      { role: "system", content: sys },
      // Replay the transcript as user/assistant turns.
      ...session.transcript
        .filter((qa) => qa.answer !== "")
        .flatMap<{ role: "user" | "assistant"; content: string }>(
          (qa) => [
            { role: "assistant" as const, content: qa.question },
            { role: "user" as const, content: qa.answer },
          ],
        ),
    ],
    { sessionId: `brainstorm:${session.id}`, temperature: 0.4 },
  );
  const parsed = extractJson(reply.content, FinalPromptSchema);
  return {
    prompt: renderPrompt(parsed),
    sections: parsed.sections,
    rubricChecklist: parsed.rubric_checklist,
    track: parsed.track,
  };
}

/* ------------------------------------------------------------------ */
/*  JSON extraction + prompt rendering                                */
/* ------------------------------------------------------------------ */

function extractJson<T>(content: string, schema: z.ZodType<T>): T {
  // The LLM is told to emit raw JSON. Be defensive: strip a leading/
  // trailing markdown fence if it slipped in, and try the substring
  // between the first { and the last }.
  const trimmed = content.trim();
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fence && fence[1]) candidates.push(fence[1].trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  let lastErr: unknown = null;
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      const res = schema.safeParse(obj);
      if (res.success) return res.data;
      lastErr = res.error;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new BrainstormingError(
    `llm_json_invalid: ${(lastErr as Error)?.message ?? "unknown"}`,
    502,
  );
}

function renderPrompt(p: z.infer<typeof FinalPromptSchema>): string {
  const frontMatter = [
    "---",
    `track: ${p.track}`,
    `target_audience: ${JSON.stringify(p.target_audience)}`,
    "success_criteria:",
    ...p.success_criteria.map((s) => `  - ${JSON.stringify(s)}`),
    "rubric_checklist:",
    `  implementation_engineering_quality: ${p.rubric_checklist.implementation_engineering_quality}`,
    `  architecture_complexity_fit: ${p.rubric_checklist.architecture_complexity_fit}`,
    `  deliverable_completeness: ${p.rubric_checklist.deliverable_completeness}`,
    `  project_copy_documentation: ${p.rubric_checklist.project_copy_documentation}`,
    `  ai_agent_integration: ${p.rubric_checklist.ai_agent_integration}`,
    `  implementation_innovation: ${p.rubric_checklist.implementation_innovation}`,
    "---",
  ].join("\n");
  const body = [
    `# ${p.project_title}`,
    "",
    "## Problem",
    p.sections.problem,
    "",
    "## Users",
    p.sections.users,
    "",
    "## Solution",
    p.sections.solution,
    "",
    "## Approach",
    p.sections.approach,
    "",
    "## Tradeoffs",
    p.sections.tradeoffs,
    "",
    "## Self-score against rubric",
    p.sections.scorecard,
  ].join("\n");
  return `${frontMatter}\n\n${body}\n`;
}

function persistDraft(
  session: Session,
  result: DoneResult,
): void {
  try {
    getDb()
      .prepare(
        "INSERT INTO prompt_draft (track, answers_json, prompt) VALUES (?, ?, ?)",
      )
      .run(
        result.track,
        JSON.stringify({
          sessionId: session.id,
          locale: session.locale,
          transcript: session.transcript,
        }),
        result.prompt,
      );
  } catch {
    // Persistence is best-effort here; the route's success response
    // already carries the rendered prompt to the user.
  }
}

/* ------------------------------------------------------------------ */
/*  Test helpers                                                      */
/* ------------------------------------------------------------------ */

export const __test = {
  config,
  stepIndex: STEP_INDEX,
  firstQuestions: FIRST_QUESTIONS,
  renderPrompt,
  extractJson,
};
