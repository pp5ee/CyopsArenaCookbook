// Right-rail toast component for the Live Ticker page. Renders the
// top of the toast store, animates new entries in with a Tailwind
// `translate-x` + `opacity` keyframe, and relies on the store's
// 6 s TTL to auto-dismiss.
import { useTranslation } from "react-i18next";
import { useToastStore } from "../lib/toastStore";

export function ToastRail(): JSX.Element {
  const { t } = useTranslation();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <aside
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-20 z-30 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const message =
          toast.kind === "delta"
            ? toast.delta && toast.delta > 0
              ? t("vote.toastDeltaPositive", {
                  delta: toast.delta,
                  s: (toast.delta ?? 0) === 1 ? "" : "s",
                  credits: toast.credits ?? toast.delta * 100,
                })
              : toast.delta && toast.delta < 0
                ? t("vote.toastDeltaNegative", { delta: toast.delta })
                : t("vote.toastDeltaZero")
            : toast.kind === "credits-blocked"
              ? t("vote.toastCreditsBlocked")
              : t("vote.toastCreditsRecovered");
        return (
          <div
            key={toast.id}
            data-testid="toast"
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur animate-[slidein_0.25s_ease-out]"
          >
            <span
              aria-hidden="true"
              className={
                "mt-1 inline-block h-2 w-2 shrink-0 rounded-full " +
                (toast.kind === "delta"
                  ? toast.delta && toast.delta > 0
                    ? "bg-emerald-500"
                    : "bg-slate-400"
                  : toast.kind === "credits-blocked"
                    ? "bg-rose-500"
                    : "bg-amber-500")
              }
            />
            <p className="flex-1 text-sm text-slate-800">{message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        );
      })}
    </aside>
  );
}
