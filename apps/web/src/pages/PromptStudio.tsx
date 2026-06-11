// Prompt Studio page (AC-7 /prompt). Two entry modes — pick a
// track, or describe your idea in free text — followed by a
// chat-like stepper that walks the user through the
// Brainstorming-skill state machine. On DONE the page renders the
// final CyOps prompt with a copy-to-clipboard button and an
// "Open in CyOps" link.
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, TRACKS, isPromptAnswerDone, type PromptAnswerResponse, type Track } from "../lib/api";

type Mode = "pick" | "free" | "running" | "done" | "error";

interface AnswerEntry {
  question: string;
  answer: string;
}

interface RunningState {
  sessionId: string;
  stepName: string;
  stepIndex: number; // 0..5
  question: string;
  history: AnswerEntry[];
}

export function PromptStudio(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<Mode>("pick");
  const [track, setTrack] = useState<Track | null>(null);
  const [freeText, setFreeText] = useState("");
  const [running, setRunning] = useState<RunningState | null>(null);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finalPrompt, setFinalPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const locale = (i18n.language === "zh" ? "zh" : "en") as "en" | "zh";

  const startWithTrack = useCallback(
    async (id: Track) => {
      setTrack(id);
      setMode("running");
      setError(null);
      try {
        const out = await api.promptStart({ track: id, locale });
        setRunning({
          sessionId: out.sessionId,
          stepName: out.stepName,
          stepIndex: out.step,
          question: out.question,
          history: [],
        });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
        setMode("error");
      }
    },
    [locale],
  );

  const startWithFreeText = useCallback(async () => {
    if (!freeText.trim()) return;
    setMode("running");
    setError(null);
    try {
      const out = await api.promptStart({ freeText: freeText.trim(), locale });
      setRunning({
        sessionId: out.sessionId,
        stepName: out.stepName,
        stepIndex: out.step,
        question: out.question,
        history: [],
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setMode("error");
    }
  }, [freeText, locale]);

  const submitAnswer = useCallback(async () => {
    if (!running || !draftAnswer.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const answerText = draftAnswer.trim();
    setDraftAnswer("");
    // Optimistic: append to local history so the user sees their
    // answer immediately.
    const newHistory: AnswerEntry[] = [
      ...running.history,
      { question: running.question, answer: answerText },
    ];
    try {
      const out: PromptAnswerResponse = await api.promptAnswer({
        sessionId: running.sessionId,
        answer: answerText,
      });
      if (isPromptAnswerDone(out)) {
        setFinalPrompt(out.prompt);
        setRunning({
          ...running,
          history: newHistory,
          stepName: out.stepName,
          stepIndex: out.step,
        });
        setMode("done");
      } else {
        setRunning({
          sessionId: out.sessionId,
          stepName: out.stepName,
          stepIndex: out.step,
          question: out.question,
          history: newHistory,
        });
      }
    } catch (e) {
      // 402 and 502 are user-visible. Restore the draft so the
      // user can retry without retyping.
      setDraftAnswer(answerText);
      if (e instanceof ApiError) {
        if (e.code === "insufficient_credits") {
          setError(t("prompt.insufficient"));
        } else {
          setError(t("prompt.failGeneric"));
        }
      } else {
        setError(String(e));
      }
    } finally {
      setSubmitting(false);
    }
  }, [running, draftAnswer, submitting, t]);

  const reset = useCallback(() => {
    setMode("pick");
    setTrack(null);
    setFreeText("");
    setRunning(null);
    setDraftAnswer("");
    setFinalPrompt(null);
    setError(null);
    setCopied(false);
  }, []);

  const copyToClipboard = useCallback(async () => {
    if (!finalPrompt) return;
    try {
      await navigator.clipboard.writeText(finalPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: no-op. Some browsers (or HTTP origins) block the
      // async clipboard API. The textarea below is also selectable.
    }
  }, [finalPrompt]);

  const sortedTracks = useMemo(() => TRACKS, []);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-arena-text">{t("prompt.title")}</h1>
        <p className="mt-1 text-sm text-arena-muted">{t("prompt.intro")}</p>
      </header>

      {(mode === "pick" || mode === "free") && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-arena-border bg-arena-surface p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-arena-muted">
              {t("prompt.trackPicker")}
            </h2>
            <ul className="mt-3 space-y-2">
              {sortedTracks.map((tr) => (
                <li key={tr.id}>
                  <button
                    type="button"
                    data-testid={`track-${tr.id}`}
                    onClick={() => void startWithTrack(tr.id)}
                    className="w-full rounded-md border border-arena-border p-3 text-left transition-colors hover:border-arena-accent hover:bg-arena-surface-hover"
                  >
                    <div className="font-medium text-arena-text">{t(tr.titleKey)}</div>
                    <div className="mt-0.5 text-sm text-arena-muted">{t(tr.blurbKey)}</div>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-arena-muted">
              {t("prompt.startWithTrack")}
            </p>
          </div>

          <div className="rounded-lg border border-arena-border bg-arena-surface p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-arena-muted">
              {t("prompt.freeText")}
            </h2>
            <textarea
              data-testid="free-text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={t("prompt.freeTextPlaceholder")}
              rows={6}
              className="mt-3 w-full rounded-md border border-arena-border bg-arena-bg p-2 text-sm text-arena-text placeholder-arena-muted focus:border-arena-accent focus:outline-none"
            />
            <button
              type="button"
              data-testid="start-free-text"
              onClick={() => void startWithFreeText()}
              disabled={!freeText.trim()}
              className="mt-3 inline-flex items-center rounded-md bg-arena-accent px-4 py-2 text-sm font-medium text-arena-bg transition-colors hover:bg-arena-accent-glow disabled:bg-arena-border disabled:text-arena-muted"
            >
              {t("prompt.startFreeText")}
            </button>
          </div>
        </div>
      )}

      {mode === "running" && running && (
        <div
          data-testid="stepper"
          data-step={running.stepIndex}
          className="rounded-lg border border-arena-border bg-arena-surface p-5 shadow-sm"
        >
          <div className="mb-3 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-arena-muted">
              {running.stepName}
            </span>
            <span className="text-arena-muted">
              {t("prompt.step", { step: running.stepIndex + 1 })}
            </span>
          </div>
          <p
            data-testid="current-question"
            className="text-base text-arena-text"
          >
            {running.question}
          </p>
          {running.history.length > 0 && (
            <ol
              data-testid="history"
              className="mt-4 space-y-2 border-l-2 border-arena-border pl-4 text-sm"
            >
              {running.history.map((qa, i) => (
                <li key={i}>
                  <div className="text-arena-muted">Q: {qa.question}</div>
                  <div className="text-arena-text">A: {qa.answer}</div>
                </li>
              ))}
            </ol>
          )}

          {error && (
            <div
              role="alert"
              data-testid="step-error"
              className="mt-4 rounded border border-arena-danger/30 bg-arena-danger-dim/30 p-3 text-sm text-arena-danger"
            >
              {error}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <textarea
              data-testid="answer-input"
              value={draftAnswer}
              onChange={(e) => setDraftAnswer(e.target.value)}
              placeholder={t("prompt.answerPlaceholder")}
              rows={3}
              className="flex-1 rounded-md border border-arena-border bg-arena-bg p-2 text-sm text-arena-text placeholder-arena-muted focus:border-arena-accent focus:outline-none"
            />
            <button
              type="button"
              data-testid="submit-answer"
              onClick={() => void submitAnswer()}
              disabled={!draftAnswer.trim() || submitting}
              className="self-end rounded-md bg-arena-accent px-4 py-2 text-sm font-medium text-arena-bg transition-colors hover:bg-arena-accent-glow disabled:bg-arena-border disabled:text-arena-muted"
            >
              {submitting ? t("common.loading") : t("common.submit")}
            </button>
          </div>

          {running.history.length > 0 && (
            <button
              type="button"
              data-testid="back-to-start"
              onClick={reset}
              className="mt-3 text-xs text-arena-muted hover:text-arena-accent"
            >
              {t("prompt.backToStart")}
            </button>
          )}
        </div>
      )}

      {mode === "done" && finalPrompt && (
        <div
          data-testid="result"
          className="rounded-lg border border-arena-success/50 bg-arena-success-dim/30 p-5 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-arena-text">{t("prompt.result")}</h2>
          <p className="mt-1 text-sm text-arena-muted">{t("prompt.resultHint")}</p>

          <textarea
            data-testid="result-block"
            readOnly
            value={finalPrompt}
            rows={18}
            className="mt-3 w-full rounded-md border border-arena-border bg-arena-bg p-3 font-mono text-xs text-arena-text focus:outline-none"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="copy"
              onClick={() => void copyToClipboard()}
              className="inline-flex items-center rounded-md border border-arena-border bg-arena-surface px-3 py-1.5 text-sm font-medium text-arena-text hover:bg-arena-surface-hover"
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
            <a
              data-testid="open-in-cyops"
              href="https://www.cyops.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md bg-arena-accent px-3 py-1.5 text-sm font-medium text-arena-bg hover:bg-arena-accent-glow"
            >
              {t("common.openInCyops")}
            </a>
            <button
              type="button"
              onClick={reset}
              className="ml-auto text-sm text-arena-muted hover:text-arena-accent"
            >
              {t("prompt.backToStart")}
            </button>
          </div>
        </div>
      )}

      {mode === "error" && (
        <div
          data-testid="startup-error"
          className="rounded-lg border border-arena-danger/30 bg-arena-danger-dim/30 p-5 text-sm text-arena-danger"
        >
          <p>{error ?? t("common.error")}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 rounded-md border border-arena-danger/50 bg-arena-surface px-3 py-1.5 text-sm font-medium text-arena-danger hover:bg-arena-danger-dim/30"
          >
            {t("common.retry")}
          </button>
        </div>
      )}

      {track && mode !== "done" && (
        <p className="text-xs text-arena-muted">
          {t("prompt.trackPicker")}: <span className="font-mono">{track}</span>
        </p>
      )}
    </section>
  );
}
