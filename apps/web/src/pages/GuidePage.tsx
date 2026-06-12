// GuidePage — Cyberpunk dashboard main page. Replaces the old
// Guide + Landing pages. Shows hackathon rules, scoring rubric,
// tracks, live votes, credits, and a CTA to generate ideas.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, TRACKS, RUBRIC_DIMENSIONS, type CreditBalance, type VoteSummary } from "../lib/api";

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

  // ── Scoring bar max for visual ──
  const maxWeight = 20;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8 animate-fade-in-up">
      {/* ── Hero / Title ── */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          <span className="text-arena-accent glow-text-accent">CyOps</span>
          <span className="text-arena-text"> × </span>
          <span className="text-cyber-purple glow-purple">Minimax</span>
          <span className="text-arena-text"> Hackathon</span>
        </h1>
        <p className="text-arena-muted text-sm sm:text-base max-w-xl mx-auto">
          Your AI-powered cookbook for hackathon success — rules, scoring, and idea generation in one place.
        </p>
      </div>

      {/* ── Stats Bar ── */}
      <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
        {/* Votes */}
        <div className="cyber-card rounded-lg px-6 py-4 text-center min-w-[140px]">
          <div className="text-xs font-semibold uppercase tracking-widest text-arena-muted">
            {t("landing.votesLabel")}
          </div>
          <div className="mt-1 text-3xl sm:text-4xl font-bold font-mono text-cyber-green glow-green">
            {votes?.current?.toLocaleString() ?? "…"}
          </div>
          {votes?.lastDelta ? (
            <div className="mt-0.5 text-xs text-cyber-green/70">
              +{votes.lastDelta} new
            </div>
          ) : null}
        </div>

        {/* Credits */}
        <div className="cyber-card rounded-lg px-6 py-4 text-center min-w-[140px]">
          <div className="text-xs font-semibold uppercase tracking-widest text-arena-muted">
            {credits?.blocked ? t("credits.poolBlocked") : t("credits.poolLabel")}
          </div>
          <div className={`mt-1 text-3xl sm:text-4xl font-bold font-mono ${
            credits?.blocked ? "text-arena-danger" : "text-arena-accent glow-text-accent"
          }`}>
            {credits?.balance ?? "…"}
          </div>
          <div className="mt-0.5 text-xs text-arena-muted">
            {t("landing.poolHint")}
          </div>
        </div>
      </div>

      {/* ── Three-panel Dashboard ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Panel 1: Rules */}
        <div className="cyber-card rounded-lg p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-cyber-blue">
            <span className="text-base">📋</span>
            {t("guide.rules.title")}
          </h2>
          <ul className="space-y-2.5 text-sm text-arena-muted">
            <li className="flex gap-2">
              <span className="text-arena-accent mt-0.5 shrink-0">▸</span>
              <span>Pick a track that matches your skills — Ship-a-Feature, MCP Server, Refactor, or Resurrection.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-arena-accent mt-0.5 shrink-0">▸</span>
              <span>Use the AI Idea Generator to create a CyOps-ready project prompt in minutes.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-arena-accent mt-0.5 shrink-0">▸</span>
              <span>Open your prompt in CyOps to auto-generate your project scaffold.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-arena-accent mt-0.5 shrink-0">▸</span>
              <span>Each vote on the Arena adds +100 credits to the shared AI pool.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-arena-accent mt-0.5 shrink-0">▸</span>
              <span>AI requests cost 20 credits — the pool is shared across all participants.</span>
            </li>
          </ul>
        </div>

        {/* Panel 2: Scoring Rubric */}
        <div className="cyber-card rounded-lg p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-cyber-pink">
            <span className="text-base">📊</span>
            {t("guide.scoring.title")}
          </h2>
          <div className="space-y-2.5">
            {RUBRIC_DIMENSIONS.map((dim) => {
              const pct = (dim.weight / maxWeight) * 100;
              return (
                <div key={dim.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-arena-text truncate mr-2">{t(dim.titleKey)}</span>
                    <span className="text-arena-accent font-mono">{dim.weight}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-arena-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-arena-accent to-cyber-pink transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-arena-muted pt-1">
            AI judges score 60% + Community votes 40% = Final ranking
          </p>
        </div>

        {/* Panel 3: Recommended Tracks */}
        <div className="cyber-card rounded-lg p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-cyber-green">
            <span className="text-base">🏁</span>
            {t("guide.scoring.tracksTitle")}
          </h2>
          <div className="space-y-2">
            {TRACKS.map((tr) => (
              <Link
                key={tr.id}
                to={`/ideas?track=${tr.id}`}
                className="block rounded-md border border-arena-border p-2.5 transition-all
                           hover:border-arena-accent hover:bg-arena-accent/5 group"
              >
                <div className="text-xs font-semibold text-arena-text group-hover:text-arena-accent transition-colors">
                  {t(tr.titleKey)}
                </div>
                <div className="mt-0.5 text-xs text-arena-muted line-clamp-2">
                  {t(tr.blurbKey)}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div className="text-center pt-2">
        <Link
          to="/ideas"
          data-testid="guide-cta"
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-arena-accent to-cyber-purple
                     px-8 py-4 text-lg font-semibold text-white shadow-glow-accent-lg animate-glow-pulse
                     transition-all hover:scale-105 hover:shadow-glow-purple"
        >
          <span className="text-xl">⚡</span>
          {t("landing.cta")}
        </Link>
      </div>
    </div>
  );
}
