// IdeasPage — Two modes: Quick Generate (one-shot) and Chat Quiz (streaming).
// Cyberpunk chat-style interface for generating hackathon project ideas.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  api, ApiError, TRACKS,
  type Track, type QuickIdeaProject, type QuickIdeaSource,
} from "../lib/api";

type Mode = "entry" | "quick-loading" | "quick-done" | "chat-quiz" | "done" | "error";

interface ChatMessage {
  role: "agent" | "user";
  content: string;
  sources?: QuickIdeaSource[];
}

interface QuizState {
  sessionId: string;
  step: number;
  stepName: string;
  question: string;
  history: { question: string; answer: string }[];
}

export function IdeasPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const locale = (i18n.language === "zh" ? "zh" : "en") as "en" | "zh";

  const [mode, setMode] = useState<Mode>("entry");
  const [error, setError] = useState<string | null>(null);

  // Quick gen state
  const [quickProject, setQuickProject] = useState<QuickIdeaProject | null>(null);
  const [quickIdeaText, setQuickIdeaText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // Chat quiz state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);
  const [freeText, setFreeText] = useState("");
  const [finalPrompt, setFinalPrompt] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Pre-select track from URL param
  useEffect(() => {
    const tParam = searchParams.get("track") as Track | null;
    if (tParam && TRACKS.some(tr => tr.id === tParam)) {
      setTrack(tParam);
    }
  }, [searchParams]);

  // ── Quick Generate ──
  const runQuickGen = useCallback(async () => {
    setMode("quick-loading");
    setError(null);
    try {
      const res = await api.quickIdea({ idea: quickIdeaText || undefined, locale });
      setQuickProject(res.project);
      setMode("quick-done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setMode("error");
    }
  }, [quickIdeaText, locale]);

  // ── Chat Quiz: Start ──
  const startQuiz = useCallback(async () => {
    setMode("chat-quiz");
    setError(null);
    setMessages([]);
    try {
      const res = await api.chatStreamStart({
        track: track ?? undefined,
        freeText: freeText || undefined,
        locale,
      });
      setQuiz({
        sessionId: res.sessionId,
        step: res.step,
        stepName: res.stepName,
        question: res.question,
        history: [],
      });
      setMessages([{ role: "agent", content: res.question }]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setMode("error");
    }
  }, [track, freeText, locale]);

  // ── Chat Quiz: Answer ──
  const submitQuizAnswer = useCallback(async () => {
    if (!quiz || !draftAnswer.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const answerText = draftAnswer.trim();
    setDraftAnswer("");

    // Optimistic user message
    setMessages(prev => [...prev, { role: "user", content: answerText }]);

    try {
      const res = await api.chatStreamAnswer({
        sessionId: quiz.sessionId,
        answer: answerText,
        locale,
      });

      if (res.prompt) {
        // Done!
        setFinalPrompt(res.prompt);
        setMessages(prev => [...prev, {
          role: "agent",
          content: "✅ Your CyOps prompt is ready! Scroll down to copy it.",
        }]);
        setMode("done");
      } else if (res.question) {
        setQuiz({
          sessionId: res.sessionId ?? quiz.sessionId,
          step: res.step ?? quiz.step + 1,
          stepName: res.stepName ?? "",
          question: res.question,
          history: [...quiz.history, { question: quiz.question, answer: answerText }],
        });
        setMessages(prev => [...prev, { role: "agent", content: res.question! }]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      // Remove optimistic message on error
      setMessages(prev => prev.slice(0, -1));
      setDraftAnswer(answerText); // Restore draft
    } finally {
      setSubmitting(false);
    }
  }, [quiz, draftAnswer, submitting, locale]);

  // ── Copy ──
  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* noop */ }
  }, []);

  const reset = useCallback(() => {
    setMode("entry");
    setQuickProject(null);
    setQuickIdeaText("");
    setMessages([]);
    setQuiz(null);
    setDraftAnswer("");
    setFinalPrompt(null);
    setError(null);
    setTrack(null);
    setFreeText("");
  }, []);

  // ── Render: Entry screen ──
  if (mode === "entry") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-8 animate-fade-in-up">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-arena-text">
            <span className="text-arena-accent glow-text-accent">Generate</span> Your Idea
          </h1>
          <p className="text-arena-muted text-sm">
            Quick AI generation or guided brainstorming — choose your path.
          </p>
        </div>

        {/* Two cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Quick Generate */}
          <button
            type="button"
            onClick={runQuickGen}
            data-testid="quick-gen-card"
            className="cyber-card rounded-lg p-6 text-left space-y-3 transition-all
                       hover:border-cyber-green hover:shadow-glow-green group"
          >
            <div className="text-3xl">⚡</div>
            <h2 className="text-lg font-semibold text-arena-text group-hover:text-cyber-green transition-colors">
              Quick Generate
            </h2>
            <p className="text-sm text-arena-muted">
              AI analyzes trends + hackathon requirements to create a complete project idea in one shot.
            </p>
            <div className="flex items-center gap-1 text-xs text-arena-accent">
              <span>Instant result</span>
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </button>

          {/* Chat Quiz */}
          <button
            type="button"
            onClick={startQuiz}
            data-testid="chat-quiz-card"
            className="cyber-card rounded-lg p-6 text-left space-y-3 transition-all
                       hover:border-cyber-purple hover:shadow-glow-purple group"
          >
            <div className="text-3xl">💬</div>
            <h2 className="text-lg font-semibold text-arena-text group-hover:text-cyber-purple transition-colors">
              Chat Quiz
            </h2>
            <p className="text-sm text-arena-muted">
              Guided brainstorming with the AI — answer questions to refine your project design step by step.
            </p>
            <div className="flex items-center gap-1 text-xs text-cyber-purple">
              <span>6-step interview</span>
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </button>
        </div>

        {/* Optional: idea input & track selector for chat quiz */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-arena-muted mb-1.5">
              Your idea (optional)
            </label>
            <textarea
              value={freeText}
              onChange={e => setFreeText(e.target.value)}
              placeholder="e.g. A browser extension that summarizes long PDFs into 3 bullet points…"
              rows={2}
              className="w-full rounded-md border border-arena-border bg-arena-surface p-2.5 text-sm
                         text-arena-text placeholder-arena-muted focus:border-arena-accent focus:outline-none
                         resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-arena-muted mb-1.5">
              Recommended tracks
            </label>
            <div className="flex flex-wrap gap-2">
              {TRACKS.map(tr => (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => setTrack(track === tr.id ? null : tr.id)}
                  data-testid={`track-chip-${tr.id}`}
                  className={`rounded-full px-3 py-1 text-xs transition-all border
                    ${track === tr.id
                      ? "border-arena-accent bg-arena-accent/10 text-arena-accent"
                      : "border-arena-border text-arena-muted hover:border-arena-border hover:text-arena-text"
                    }`}
                >
                  {t(tr.titleKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Quick Loading ──
  if (mode === "quick-loading") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-6 animate-fade-in-up">
        <div className="inline-flex items-center gap-2 text-arena-accent">
          <span className="text-2xl animate-bounce">⚡</span>
          <span className="text-lg font-semibold">Generating your idea...</span>
        </div>
        <div className="space-y-2 max-w-md mx-auto">
          {["Scanning trends...", "Analyzing hackathon tracks...", "Crafting project design...", "Preparing prompts..."].map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-sm text-arena-muted animate-fade-in-up"
              style={{ animationDelay: `${i * 0.5}s` }}
            >
              <div className="h-1.5 w-1.5 rounded-full bg-arena-accent animate-glow-pulse" />
              {step}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render: Quick Done ──
  if (mode === "quick-done" && quickProject) {
    const p = quickProject;
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6 animate-fade-in-up">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-1 rounded-full border border-cyber-green/30
                          bg-cyber-green/5 px-3 py-0.5 text-xs text-cyber-green">
            ⚡ Quick Generate
          </div>
          <h1 className="text-2xl font-bold text-arena-text mt-2">{p.projectTitle}</h1>
          <p className="text-arena-muted text-sm">{p.tagline}</p>
        </div>

        {/* Project overview */}
        <div className="cyber-card rounded-lg p-5 space-y-4">
          <Section title="🎯 Problem" text={p.problem} />
          <Section title="👥 Target Users" text={p.targetUsers} />
          <Section title="💡 Solution" text={p.solution} />

          {p.keyFeatures.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-arena-muted mb-2">
                ✨ Key Features
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {p.keyFeatures.map((f, i) => (
                  <span key={i} className="rounded-full bg-arena-accent/10 border border-arena-accent/20
                                           px-2.5 py-0.5 text-xs text-arena-text">{f}</span>
                ))}
              </div>
            </div>
          )}

          {p.techStack.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-arena-muted mb-2">
                🛠️ Tech Stack
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {p.techStack.map((tech, i) => (
                  <span key={i} className="rounded bg-arena-surface border border-arena-border
                                           px-2 py-0.5 text-xs text-arena-text font-mono">{tech}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* UI Design Prompt */}
        {p.uiDesignPrompt && (
          <PromptBlock
            label="🎨 UI Design Prompt"
            text={p.uiDesignPrompt}
            copied={copied === "ui"}
            onCopy={() => copyText(p.uiDesignPrompt, "ui")}
          />
        )}

        {/* Backend Design Prompt */}
        {p.backendDesignPrompt && (
          <PromptBlock
            label="⚙️ Backend Design Prompt"
            text={p.backendDesignPrompt}
            copied={copied === "be"}
            onCopy={() => copyText(p.backendDesignPrompt, "be")}
          />
        )}

        {/* Sources (Monica-style) */}
        {p.sources && p.sources.length > 0 && (
          <div className="cyber-card rounded-lg p-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-arena-muted">
              📎 Sources & References
            </h3>
            <div className="space-y-2">
              {p.sources.map((src, i) => (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-md border border-arena-border p-3
                             transition-colors hover:border-arena-accent hover:bg-arena-accent/5 group"
                >
                  <div className="mt-0.5 shrink-0 w-6 h-6 rounded bg-arena-surface flex items-center justify-center
                                  text-xs font-bold text-arena-accent border border-arena-border">
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-arena-text group-hover:text-arena-accent transition-colors truncate">
                      {src.title}
                    </div>
                    <div className="text-xs text-arena-muted mt-0.5">{src.relevance}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-3 justify-center">
          <a
            href="https://www.cyops.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-arena-accent px-6 py-3
                       text-sm font-semibold text-arena-bg hover:bg-arena-accent-glow transition-all"
          >
            {t("common.openInCyops")}
          </a>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-arena-border px-6 py-3 text-sm text-arena-muted
                       hover:text-arena-text hover:border-arena-text transition-all"
          >
            Generate Another
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Chat Quiz ──
  if ((mode === "chat-quiz" || mode === "done") && quiz) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4 animate-fade-in-up">
        {/* Chat messages */}
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm animate-bubble-in ${
                  msg.role === "user"
                    ? "bg-arena-accent/15 border border-arena-accent/30 text-arena-text"
                    : "bg-arena-surface border border-arena-border text-arena-text"
                }`}
                style={{ animationDelay: "0s" }}
              >
                <div className="text-xs text-arena-muted mb-0.5 font-semibold uppercase tracking-wider">
                  {msg.role === "agent" ? "🤖 AI Guide" : "👤 You"}
                </div>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Answer input (only in chat-quiz mode) */}
        {mode === "chat-quiz" && (
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={draftAnswer}
              onChange={e => setDraftAnswer(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitQuizAnswer();
                }
              }}
              placeholder="Type your answer... (Enter to send)"
              rows={2}
              data-testid="quiz-answer-input"
              className="flex-1 rounded-md border border-arena-border bg-arena-surface p-2.5 text-sm
                         text-arena-text placeholder-arena-muted focus:border-arena-accent focus:outline-none
                         resize-none"
            />
            <button
              type="button"
              onClick={() => void submitQuizAnswer()}
              disabled={!draftAnswer.trim() || submitting}
              data-testid="quiz-submit"
              className="shrink-0 rounded-md bg-arena-accent px-4 py-2.5 text-sm font-medium
                         text-arena-bg transition-colors hover:bg-arena-accent-glow
                         disabled:bg-arena-border disabled:text-arena-muted"
            >
              {submitting ? "..." : "Send"}
            </button>
          </div>
        )}

        {/* Final prompt (done mode) */}
        {mode === "done" && finalPrompt && (
          <div className="cyber-card rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold text-arena-text">✅ Your CyOps Prompt</h3>
            <textarea
              readOnly
              value={finalPrompt}
              rows={14}
              data-testid="quiz-result"
              className="w-full rounded-md border border-arena-border bg-arena-bg p-3 font-mono text-xs
                         text-arena-text focus:outline-none resize-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copyText(finalPrompt, "quiz")}
                className="rounded-md bg-arena-accent px-4 py-2 text-sm font-medium
                           text-arena-bg hover:bg-arena-accent-glow transition-colors"
              >
                {copied === "quiz" ? t("common.copied") : t("common.copy")}
              </button>
              <a
                href="https://www.cyops.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-arena-border px-4 py-2 text-sm text-arena-text
                           hover:bg-arena-surface-hover transition-colors"
              >
                {t("common.openInCyops")}
              </a>
              <button
                type="button"
                onClick={reset}
                className="ml-auto text-sm text-arena-muted hover:text-arena-accent"
              >
                Start Over
              </button>
            </div>
          </div>
        )}

        {/* Step indicator */}
        {quiz && mode === "chat-quiz" && (
          <div className="flex items-center gap-2 text-xs text-arena-muted">
            <span>Step {quiz.step + 1}/6</span>
            <span className="text-arena-accent">{quiz.stepName}</span>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded border border-arena-danger/30 bg-arena-danger-dim/30 p-3 text-sm text-arena-danger">
            {error}
            <button type="button" onClick={reset} className="ml-2 underline">Reset</button>
          </div>
        )}
      </div>
    );
  }

  // ── Render: Error ──
  if (mode === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-4">
        <div className="text-3xl">😕</div>
        <p className="text-arena-danger">{error ?? t("common.error")}</p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-arena-accent px-4 py-2 text-sm font-medium text-arena-bg
                     hover:bg-arena-accent-glow transition-colors"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return <></>;
}

// ── Sub-components ──

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-arena-muted mb-1">
        {title}
      </h3>
      <p className="text-sm text-arena-text leading-relaxed">{text}</p>
    </div>
  );
}

function PromptBlock({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="cyber-card rounded-lg p-5 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-arena-muted">{label}</h3>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border border-arena-border px-2 py-0.5 text-xs text-arena-muted
                     hover:text-arena-text hover:border-arena-text transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="text-xs text-arena-text whitespace-pre-wrap font-mono bg-arena-bg rounded-md p-3
                       border border-arena-border max-h-48 overflow-y-auto">
        {text}
      </pre>
    </div>
  );
}
