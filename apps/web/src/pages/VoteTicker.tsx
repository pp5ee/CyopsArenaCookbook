// Live Ticker page (AC-7 /vote). Shows the current vote count, a
// sparkline from /api/votes, and listens to /api/votes/stream SSE
// for vote deltas + credits threshold crossings. The right-side
// toast rail (components/ToastRail.tsx) animates new events in
// and auto-dismisses after 6 s.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type VoteSummary } from "../lib/api";
import { Sparkline } from "../components/Sparkline";
import { ToastRail } from "../components/ToastRail";
import { useToastStore, type ToastKind } from "../lib/toastStore";

const POLL_MS = 5_000;

type SseEvent =
  | { type: "vote"; delta: number; current: number; observedAt: string }
  | { type: "credits"; balance: number; blocked: boolean }
  | { type: "ping"; ts: number };

function classifyVoteEvent(prev: VoteSummary | null, ev: SseEvent): {
  next: VoteSummary;
  kind: ToastKind;
  delta: number;
  credits: number;
} | null {
  if (ev.type !== "vote") return null;
  const next: VoteSummary = {
    current: ev.current,
    lastDelta: ev.delta,
    observedAt: ev.observedAt,
    history: prev ? [...prev.history, { votes: ev.current, observedAt: ev.observedAt }].slice(-50) : [{ votes: ev.current, observedAt: ev.observedAt }],
  };
  return {
    next,
    kind: "delta",
    delta: ev.delta,
    credits: ev.delta > 0 ? ev.delta * 100 : 0,
  };
}

export function VoteTicker(): JSX.Element {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<VoteSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const push = useToastStore((s) => s.push);

  // Initial load + 5 s polling fallback (the SSE stream is the
  // primary source of truth; the poll covers dropped events).
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await api.votes();
        if (!cancelled) setSummary(s);
        if (!cancelled) setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : String(e));
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // SSE consumer. We track the previous summary locally so we can
  // diff each `vote` event and push a toast.
  useEffect(() => {
    const es = new EventSource("/api/votes/stream");
    let prev = summary;
    const onMessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as SseEvent;
        if (ev.type === "vote") {
          const out = classifyVoteEvent(prev, ev);
          if (out) {
            setSummary(out.next);
            prev = out.next;
            push({ kind: out.kind, delta: out.delta, credits: out.credits });
          }
        } else if (ev.type === "credits") {
          push({ kind: ev.blocked ? "credits-blocked" : "credits-recovered" });
        }
        // 'ping' is for keepalive only.
      } catch {
        // ignore malformed events
      }
    };
    es.onmessage = onMessage;
    es.onerror = () => {
      // EventSource auto-reconnects with backoff; we just surface
      // the connection state via the toast rail (handled by
      // classifyVoteEvent on the next successful event).
    };
    return () => {
      es.close();
    };
  }, [push]);

  return (
    <>
      <ToastRail />
      <section className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">{t("vote.title")}</h1>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Stat label={t("vote.current")} value={summary?.current ?? "—"} mono />
          <Stat
            label={t("vote.lastDelta")}
            value={
              summary
                ? summary.lastDelta > 0
                  ? `+${summary.lastDelta}`
                  : `${summary.lastDelta}`
                : "—"
            }
            mono
          />
          <Stat label={t("vote.observedAt")} value={summary?.observedAt ?? "—"} />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t("vote.history")}
          </h2>
          <div className="mt-3">
            <Sparkline history={summary?.history ?? []} />
          </div>
        </div>

        {err && (
          <div
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
          >
            {err}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}): JSX.Element {
  return (
    <div
      data-testid="vote-stat"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={
          "mt-2 text-2xl font-semibold text-slate-900 " + (mono ? "font-mono" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
