// VoteForMePage — Replaces the old VoteTicker. Shows an animated
// vote growth chart, live vote feed, and a CTA button to vote on the
// arena. Cyberpunk styled.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type VoteSummary, type CreditBalance } from "../lib/api";

const VOTE_POLL_MS = 5_000;
const CREDITS_POLL_MS = 10_000;
const ARENA_URL = "https://arena.cysic.xyz/";

interface VoteEntry {
  id: number;
  delta: number;
  total: number;
  time: string;
}

export function VoteForMePage(): JSX.Element {
  const [votes, setVotes] = useState<VoteSummary | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [feed, setFeed] = useState<VoteEntry[]>([]);
  const feedIdRef = useRef(0);

  const votesRef = useRef<VoteSummary | null>(null);
  useEffect(() => { votesRef.current = votes; }, [votes]);

  // ── Votes poll + SSE ──
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
          const delta = ev.delta ?? 0;
          const next: VoteSummary = {
            current: ev.current,
            lastDelta: delta,
            observedAt: ev.observedAt ?? prev?.observedAt ?? "",
            history: prev
              ? [...prev.history, { votes: ev.current, observedAt: ev.observedAt ?? "" }].slice(-50)
              : [{ votes: ev.current, observedAt: ev.observedAt ?? "" }],
          };
          setVotes(next);
          votesRef.current = next;

          // Add to feed if delta > 0
          if (delta > 0) {
            feedIdRef.current += 1;
            setFeed(prev => [
              {
                id: feedIdRef.current,
                delta,
                total: ev.current!,
                time: new Date().toLocaleTimeString(),
              },
              ...prev,
            ].slice(0, 20));
          }
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  // ── Credits ──
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try { const c = await api.credits(); if (!cancelled) setCredits(c); } catch { /* */ }
    }
    void tick();
    const id = setInterval(() => void tick(), CREDITS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── Chart data ──
  const chartData = useMemo(() => {
    if (!votes?.history || votes.history.length < 2) return null;
    const points = votes.history.filter(h => h.votes > 0);
    if (points.length < 2) return null;
    const maxV = Math.max(...points.map(p => p.votes));
    const minV = Math.min(...points.map(p => p.votes));
    const range = maxV - minV || 1;
    return points.map((p, i) => ({
      x: (i / (points.length - 1)) * 100,
      y: 100 - ((p.votes - minV) / range) * 90 - 5, // 5% padding
      votes: p.votes,
    }));
  }, [votes?.history]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-8 animate-fade-in-up">
      {/* ── Header ── */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-arena-text">
          <span className="text-cyber-pink glow-pink">Vote</span>
          <span className="text-arena-text"> for Us</span>
        </h1>
        <p className="text-arena-muted text-sm">
          Each vote adds +100 credits to the shared AI pool. Help everyone generate better ideas!
        </p>
      </div>

      {/* ── Stats row ── */}
      <div className="flex flex-wrap items-center justify-center gap-6">
        {/* Total votes */}
        <div className="cyber-card rounded-lg px-8 py-5 text-center min-w-[160px]">
          <div className="text-xs font-semibold uppercase tracking-widest text-arena-muted">
            Total Votes
          </div>
          <div className="mt-2 text-4xl sm:text-5xl font-bold font-mono text-cyber-green glow-green">
            {votes?.current?.toLocaleString() ?? "…"}
          </div>
          {votes?.lastDelta ? (
            <div className="mt-1 text-xs text-cyber-green/70 animate-vote-slide-in">
              ↑ +{votes.lastDelta} this round
            </div>
          ) : null}
        </div>

        {/* Credit pool */}
        <div className="cyber-card rounded-lg px-8 py-5 text-center min-w-[160px]">
          <div className="text-xs font-semibold uppercase tracking-widest text-arena-muted">
            {credits?.blocked ? "Pool Paused" : "Credits Remaining"}
          </div>
          <div className={`mt-2 text-4xl sm:text-5xl font-bold font-mono ${
            credits?.blocked ? "text-arena-danger" : "text-arena-accent glow-text-accent"
          }`}>
            {credits?.balance ?? "…"}
          </div>
          <div className="mt-1 text-xs text-arena-muted">
            +100 per vote · 20 per AI call
          </div>
        </div>
      </div>

      {/* ── Chart ── */}
      <div className="cyber-card rounded-lg p-5 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-arena-muted">
          📈 Vote Growth
        </h2>
        {chartData ? (
          <div className="relative w-full" style={{ height: 200 }}>
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="w-full h-full"
            >
              {/* Grid lines */}
              {[25, 50, 75].map(y => (
                <line
                  key={y}
                  x1="0" y1={y} x2="100" y2={y}
                  stroke="rgba(6,182,212,0.08)"
                  strokeWidth="0.5"
                />
              ))}
              {/* Area fill */}
              <polygon
                points={`0,100 ${chartData.map(p => `${p.x},${p.y}`).join(" ")} 100,100`}
                fill="url(#voteGradient)"
                opacity="0.3"
              />
              <defs>
                <linearGradient id="voteGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#39FF14" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#39FF14" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Line */}
              <polyline
                points={chartData.map(p => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#39FF14"
                strokeWidth="1.5"
                className="chart-line-animate"
                style={{ strokeDasharray: 200, animation: "draw-line 2s ease-out forwards" }}
              />
              {/* Data points */}
              {chartData.filter((_, i) => i % Math.max(1, Math.floor(chartData.length / 8)) === 0 || i === chartData.length - 1).map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r="1.5"
                  fill="#39FF14"
                  className="animate-glow-pulse"
                />
              ))}
            </svg>
            {/* Y-axis labels */}
            <div className="flex justify-between text-xs text-arena-muted mt-1">
              <span>{chartData[0]?.votes?.toLocaleString()}</span>
              <span>{chartData[chartData.length - 1]?.votes?.toLocaleString()}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[200px] text-arena-muted text-sm">
            Collecting vote data...
          </div>
        )}
      </div>

      {/* ── Live feed ── */}
      <div className="cyber-card rounded-lg p-5 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-arena-muted">
          🔴 Live Vote Activity
        </h2>
        {feed.length > 0 ? (
          <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
            {feed.map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-3 rounded-md border border-arena-border/50
                           bg-arena-surface/50 px-3 py-2 animate-vote-slide-in"
              >
                <div className="flex items-center gap-1 text-cyber-green font-mono text-sm font-bold min-w-[70px]">
                  <span>↑</span>+{entry.delta}
                </div>
                <div className="text-sm text-arena-text font-mono tabular-nums">
                  {entry.total.toLocaleString()} total
                </div>
                <div className="ml-auto text-xs text-arena-muted">
                  {entry.time}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-arena-muted py-4 text-center">
            Waiting for new votes... The feed updates automatically.
          </div>
        )}
      </div>

      {/* ── CTA ── */}
      <div className="text-center space-y-3 pt-2">
        <a
          href={ARENA_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="vote-cta"
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyber-pink to-arena-accent
                     px-8 py-4 text-lg font-semibold text-white shadow-glow-accent-lg animate-glow-pulse
                     transition-all hover:scale-105 hover:shadow-glow-pink"
        >
          <span className="text-xl">🗳️</span>
          Vote for Us on CyOps Arena
        </a>
        <p className="text-xs text-arena-muted">
          Every vote adds +100 credits to the shared AI pool
        </p>
      </div>
    </div>
  );
}
