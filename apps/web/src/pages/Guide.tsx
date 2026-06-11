// Guide page (AC-7 /). Three tabs: Rules, Prizes, Scoring. The
// Scoring tab shows the six rubric dimensions with weights and a
// fixed table of the four recommended tracks. Tab state is
// local; the page re-renders on language change without losing
// the active tab.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { TRACKS, RUBRIC_DIMENSIONS } from "../lib/api";

type Tab = "rules" | "prizes" | "scoring";

const TABS: { id: Tab; key: string }[] = [
  { id: "rules", key: "guide.tabs.rules" },
  { id: "prizes", key: "guide.tabs.prizes" },
  { id: "scoring", key: "guide.tabs.scoring" },
];

export function Guide(): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("rules");

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("guide.title")}</h1>

      <div role="tablist" aria-label={t("guide.title")} className="flex gap-1 border-b border-slate-200">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            type="button"
            aria-selected={tab === tb.id}
            data-testid={`tab-${tb.id}`}
            onClick={() => setTab(tb.id)}
            className={
              "rounded-t px-4 py-2 text-sm font-medium " +
              (tab === tb.id
                ? "border-b-2 border-indigo-600 text-indigo-700"
                : "text-slate-600 hover:text-slate-900")
            }
          >
            {t(tb.key)}
          </button>
        ))}
      </div>

      {tab === "rules" && (
        <article data-testid="tabpanel-rules" className="prose prose-slate max-w-none">
          <h2 className="text-lg font-semibold text-slate-900">{t("guide.rules.title")}</h2>
          <p className="leading-relaxed text-slate-700">{t("guide.rules.body")}</p>
        </article>
      )}

      {tab === "prizes" && (
        <article data-testid="tabpanel-prizes" className="prose prose-slate max-w-none">
          <h2 className="text-lg font-semibold text-slate-900">{t("guide.prizes.title")}</h2>
          <p className="leading-relaxed text-slate-700">{t("guide.prizes.body")}</p>
        </article>
      )}

      {tab === "scoring" && (
        <article data-testid="tabpanel-scoring" className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t("guide.scoring.title")}</h2>
            <p className="mt-1 leading-relaxed text-slate-700">{t("guide.scoring.intro")}</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("guide.scoring.rubric")}
            </h3>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-medium">Dimension</th>
                    <th className="px-4 py-2 text-right font-medium">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {RUBRIC_DIMENSIONS.map((d) => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-800">{t(d.titleKey)}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700">{d.weight}%</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-4 py-2 text-slate-900">Total</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-900">
                      {RUBRIC_DIMENSIONS.reduce((a, b) => a + b.weight, 0)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("guide.scoring.tracksTitle")}
            </h3>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TRACKS.map((track) => (
                <li
                  key={track.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <h4 className="font-semibold text-slate-900">{t(track.titleKey)}</h4>
                  <p className="mt-1 text-sm text-slate-600">{t(track.blurbKey)}</p>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-slate-500">
            <Link to="/prompt" className="text-indigo-600 hover:underline">
              {t("nav.prompt")} →
            </Link>
          </p>
        </article>
      )}
    </section>
  );
}
