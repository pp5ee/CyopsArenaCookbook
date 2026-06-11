// Thin client for the cookbook backend. The Vite dev server proxies
// /api/* to http://localhost:4000, so all calls in the browser go
// through the relative /api path. The types here mirror the route
// responses so the UI gets end-to-end type-safety.

export interface CreditBalance {
  balance: number;
  perVote: number;
  perChat: number;
  blocked: boolean;
}

export interface VoteSummary {
  current: number;
  lastDelta: number;
  observedAt: string;
  history: { votes: number; observedAt: string }[];
}

export interface PromptStartResponse {
  sessionId: string;
  question: string;
  step: number;
  stepName: "INTENT" | "CONTEXT" | "CONSTRAINTS" | "APPROACHES" | "DESIGN" | "REFINE" | "DONE";
}

export interface PromptAnswerNext {
  sessionId: string;
  step: number;
  stepName: "CONTEXT" | "CONSTRAINTS" | "APPROACHES" | "DESIGN" | "REFINE";
  question: string;
  balance: number;
}

export interface PromptSections {
  problem: string;
  users: string;
  solution: string;
  approach: string;
  tradeoffs: string;
  scorecard: string;
}

export interface PromptAnswerDone {
  sessionId: string;
  step: 6;
  stepName: "DONE";
  done: true;
  prompt: string;
  sections: PromptSections;
  rubricChecklist: {
    implementation_engineering_quality: 20;
    architecture_complexity_fit: 16;
    deliverable_completeness: 20;
    project_copy_documentation: 16;
    ai_agent_integration: 20;
    implementation_innovation: 8;
  };
  track: "ship-a-feature" | "mcp-server" | "whole-repo-refactor" | "resurrection";
  balance: number;
}

export type PromptAnswerResponse = PromptAnswerNext | PromptAnswerDone;

export function isPromptAnswerDone(r: PromptAnswerResponse): r is PromptAnswerDone {
  return (r as PromptAnswerDone).done === true;
}

export type Track = PromptAnswerDone["track"];

export const TRACKS: { id: Track; titleKey: string; blurbKey: string }[] = [
  {
    id: "ship-a-feature",
    titleKey: "tracks.ship-a-feature.title",
    blurbKey: "tracks.ship-a-feature.blurb",
  },
  {
    id: "mcp-server",
    titleKey: "tracks.mcp-server.title",
    blurbKey: "tracks.mcp-server.blurb",
  },
  {
    id: "whole-repo-refactor",
    titleKey: "tracks.whole-repo-refactor.title",
    blurbKey: "tracks.whole-repo-refactor.blurb",
  },
  {
    id: "resurrection",
    titleKey: "tracks.resurrection.title",
    blurbKey: "tracks.resurrection.blurb",
  },
];

export const RUBRIC_DIMENSIONS: {
  id: keyof PromptAnswerDone["rubricChecklist"];
  titleKey: string;
  weight: number;
}[] = [
  { id: "implementation_engineering_quality", titleKey: "rubric.implementation", weight: 20 },
  { id: "architecture_complexity_fit", titleKey: "rubric.architecture", weight: 16 },
  { id: "deliverable_completeness", titleKey: "rubric.deliverable", weight: 20 },
  { id: "project_copy_documentation", titleKey: "rubric.copy", weight: 16 },
  { id: "ai_agent_integration", titleKey: "rubric.ai", weight: 20 },
  { id: "implementation_innovation", titleKey: "rubric.innovation", weight: 8 },
];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly balance?: number;
  readonly required?: number;
  constructor(status: number, code: string, message: string, extra?: { balance?: number; required?: number }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.balance = extra?.balance;
    this.required = extra?.required;
  }
}

async function jsonFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: "invalid_json", message: text };
    }
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; balance?: number; required?: number };
    throw new ApiError(res.status, b.error ?? "http_error", b.message ?? res.statusText, {
      balance: b.balance,
      required: b.required,
    });
  }
  return body as T;
}

export const api = {
  credits: () => jsonFetch<CreditBalance>("/api/credits"),

  votes: () => jsonFetch<VoteSummary>("/api/votes"),

  promptStart: (body: { track?: Track | null; freeText?: string; locale?: "en" | "zh" }) =>
    jsonFetch<PromptStartResponse>("/api/prompt/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  promptAnswer: (body: { sessionId: string; answer: string }) =>
    jsonFetch<PromptAnswerResponse>("/api/prompt/answer", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
