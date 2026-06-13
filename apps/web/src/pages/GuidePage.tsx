// GuidePage — Minimal, image-forward home page. Shows a centered hero
// with live vote count, shared credit pool status, and a single CTA.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, type CreditBalance, type VoteSummary } from "../lib/api";
import arenaHero from "../assets/arena-hero.png";

const VOTE_POLL_MS = 5_000;
const CREDITS_POLL_MS = 10_000;

export function GuidePage(): JSX.Element {
  const { t } = useTranslation();
  const [votes, setVotes] = useState<VoteSummary | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);

  // ── Votes: poll + SSE ──
  const votesRef = useRef<VoteSummary | null>(null);
  useEffect(() => {
    votesRef.current = votes;
  }, [votes]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await api.votes();
        if (!cancelled) { setVotes(s); votesRef.current = s; }
      } catch { /* silent */ }
    }
    void tick();
    const id = setInterval(() => void tick(), VOTE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/votes/stream");
    es.onmessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as { type: string; current?: number; delta?: number; observedAt?: string };
        if (ev.type === "vote" && ev.current != null) {
          const prev = votesRef.current;
          setVotes({
            current: ev.current,
            lastDelta: ev.delta ?? 0,
            observedAt: ev.observedAt ?? prev?.observedAt ?? "",
            history: prev
              ? [...prev.history, { votes: ev.current, observedAt: ev.observedAt ?? "" }].slice(-50)
              : [{ votes: ev.current, observedAt: ev.observedAt ?? "" }],
          });
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  // ── Credits poll ──
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try { const c = await api.credits(); if (!cancelled) setCredits(c); } catch { /* */ }
    }
    void tick();
    const id = setInterval(() => void tick(), CREDITS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="relative flex items-center justify-center min-h-[calc(100vh-8rem)] overflow-hidden">
      {/* ── Background image with subtle overlay ── */}
      <div className="absolute inset-0 z-0">
        <img
          src={arenaHero}
          alt=""
          className="w-full h-full object-cover opacity-[0.12]"
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-arena-bg/70 via-arena-bg/50 to-arena-bg" />
      </div>

      {/* ── Centered hero content ── */}
      <div className="relative z-10 flex flex-col items-center gap-10 px-4 py-12 text-center w-full max-w-2xl mx-auto">
        {/* Vote counter */}
        <div data-testid="hero-votes" className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-arena-muted">
            {t("landing.votesLabel")}
          </p>
          <p className="text-6xl sm:text-7xl md:text-8xl font-bold font-mono text-cyber-green glow-green tabular-nums">
            {votes?.current?.toLocaleString() ?? "…"}
          </p>
          {votes?.lastDelta ? (
            <p className="text-sm text-cyber-green/70 font-mono">
              +{votes.lastDelta} new
            </p>
          ) : null}
        </div>

        {/* Credit pool */}
        <div data-testid="hero-credits" className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-arena-muted">
            {credits?.blocked ? t("credits.poolBlocked") : t("credits.poolLabel")}
          </p>
          <p className={`text-4xl sm:text-5xl font-bold font-mono ${
            credits?.blocked
              ? "text-arena-danger"
              : "text-arena-accent glow-text-accent"
          }`}>
            {credits?.balance ?? "…"}
          </p>
          <p className="text-sm text-arena-muted max-w-xs mx-auto">
            {t("landing.poolHint")}
          </p>
        </div>

        {/* CTA button */}
        <Link
          to="/ideas"
          data-testid="guide-cta"
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-arena-accent to-cyber-purple
                     px-10 py-5 text-xl font-semibold text-white shadow-glow-accent-lg animate-glow-pulse
                     transition-all hover:scale-105 hover:shadow-glow-purple"
        >
          {t("landing.cta")}
        </Link>
      </div>
    </div>
  );
}
