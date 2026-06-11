// Credits badge. Polls /api/credits every 10 s (the global pool
// changes whenever a vote is granted or an AI call is deducted)
// and renders the current balance in the header. When the pool
// drops below the 20-credit threshold, the badge flips to a
// paused state with the i18n string for the blocked hint.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type CreditBalance } from "../lib/api";

const POLL_MS = 10_000;

export function CreditsBadge(): JSX.Element {
  const { t } = useTranslation();
  const [bal, setBal] = useState<CreditBalance | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const b = await api.credits();
        if (!cancelled) {
          setBal(b);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof ApiError ? e.message : String(e));
        }
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (err && !bal) {
    return (
      <span
        className="rounded border border-arena-danger/30 bg-arena-danger-dim/30 px-2 py-0.5 text-xs text-arena-danger"
        title={err}
      >
        {t("common.error")}
      </span>
    );
  }
  if (!bal) {
    return (
      <span className="rounded border border-arena-border bg-arena-surface px-2 py-0.5 text-xs text-arena-muted">
        {t("common.loading")}
      </span>
    );
  }

  return (
    <span
      data-testid="credits-badge"
      data-blocked={bal.blocked ? "true" : "false"}
      className={
        "rounded border px-2 py-0.5 text-xs font-medium " +
        (bal.blocked
          ? "border-arena-danger/50 bg-arena-danger-dim/30 text-arena-danger"
          : "border-arena-success/50 bg-arena-success-dim/30 text-arena-success")
      }
      title={bal.blocked ? t("credits.blocked") : `${bal.balance} ${t("credits.label")}`}
    >
      {t("credits.label")}: {bal.balance}
      {bal.blocked ? " · ⏸" : ""}
    </span>
  );
}
