// Landing page (AC-2 /). Full-viewport hero with the arena image
// as background, live vote count, shared credit pool balance, and
// a single CTA button to start brainstorming. Fits entirely in
// one viewport — no tabs, no sidebar, no complex nav.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError, type CreditBalance, type VoteSummary } from "../lib/api";
import arenaHero from "../assets/arena-hero.png";

const VOTE_POLL_MS = 5_000;
const CREDITS_POLL_MS = 10_000;

export function Landing(): JSX.Element {
  const { t } = useTranslation();
  const [votes, setVotes] = useState<VoteSummary | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [voteErr, setVoteErr] = useState<string | null>(null);
  const [creditsErr, setCreditsErr] = useState<string | null>(null);

  // ── Votes: initial load + interval poll ──
  const votesRef = useRef<VoteSummary | null>(null);
  useEffect(() => {
    votesRef.current = votes;
  }, [votes]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await api.votes();
        if (!cancelled) {
          setVotes(s);
          votesRef.current = s;
          setVoteErr(null);
        }
      } catch (e) {
        if (!cancelled) setVoteErr(e instanceof ApiError ? e.message : String(e));
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), VOTE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── Votes: SSE stream for live updates ──
  useEffect(() => {
    const es = new EventSource("/api/votes/stream");
    es.onmessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as {
          type: string;
          current?: number;
          delta?: number;
          observedAt?: string;
        };
        if (ev.type === "vote" && ev.current != null) {
          const prev = votesRef.current;
          const next: VoteSummary = {
            current: ev.current,
            lastDelta: ev.delta ?? 0,
            observedAt: ev.observedAt ?? prev?.observedAt ?? "",
            history: prev
              ? [...prev.history, { votes: ev.current, observedAt: ev.observedAt ?? "" }].slice(-50)
              : [{ votes: ev.current, observedAt: ev.observedAt ?? "" }],
          };
          setVotes(next);
          votesRef.current = next;
        }
      } catch {
        /* ignore malformed SSE events */
      }
    };
    return () => es.close();
  }, []);

  // ── Credits: initial load + interval poll ──
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const c = await api.credits();
        if (!cancelled) {
          setCredits(c);
          setCreditsErr(null);
        }
      } catch (e) {
        if (!cancelled) setCreditsErr(e instanceof ApiError ? e.message : String(e));
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), CREDITS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div
      className="-mx-4 -my-6 flex min-h-[calc(100vh-52px)] flex-col items-center justify-center bg-cover bg-center bg-no-repeat px-4 py-6"
      style={{
        backgroundImage: `linear-gradient(to bottom, rgba(10,14,23,0.35), rgba(10,14,23,0.92)), url(${arenaHero})`,
      }}
    >
      {/* ── Tagline ── */}
      <h1 className="max-w-2xl text-center text-3xl font-bold tracking-tight text-arena-text sm:text-4xl lg:text-5xl">
        {t("landing.tagline")}
      </h1>

      {/* ── Stats row: votes + credits ── */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-8 sm:gap-12">
        {/* Vote count */}
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-arena-muted">
            {t("landing.votesLabel")}
          </div>
          <div
            data-testid="landing-votes"
            className="mt-2 text-4xl font-bold font-mono text-arena-accent-glow glow-text-accent sm:text-5xl"
          >
            {voteErr ? "—" : votes?.current ?? "…"}
          </div>
        </div>

        {/* Separator */}
        <div className="hidden h-12 w-px bg-arena-border sm:block" aria-hidden="true" />

        {/* Credit pool */}
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-arena-muted">
            {credits?.blocked ? t("credits.poolBlocked") : t("credits.poolLabel")}
          </div>
          <div
            data-testid="landing-credits"
            className={
              "mt-2 text-4xl font-bold font-mono sm:text-5xl " +
              (credits?.blocked
                ? "text-arena-danger"
                : "text-arena-accent-glow glow-text-accent")
            }
          >
            {creditsErr ? "—" : credits?.balance ?? "…"}
          </div>
          {credits && !credits.blocked && (
            <div className="mt-1 text-xs text-arena-muted">
              {t("landing.poolHint")}
            </div>
          )}
        </div>
      </div>

      {/* ── CTA button ── */}
      <Link
        to="/prompt"
        data-testid="landing-cta"
        className="mt-12 inline-flex items-center rounded-lg bg-arena-accent px-8 py-4 text-lg font-semibold text-arena-bg shadow-glow-accent transition-all hover:bg-arena-accent-glow hover:shadow-glow-accent-lg"
      >
        {t("landing.cta")}
      </Link>
    </div>
  );
}
