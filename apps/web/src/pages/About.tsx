// About page (AC-7 /about). Cookbook purpose, the scoring rubric
// (linked to the Guide page for the full sortable table), and a
// "How the Brainstorming Skill Works" pointer.
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { RUBRIC_DIMENSIONS } from "../lib/api";

export function About(): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("about.title")}</h1>

      <article className="prose prose-slate max-w-none">
        <h2 className="text-lg font-semibold text-slate-900">{t("about.purposeTitle")}</h2>
        <p className="leading-relaxed text-slate-700">{t("about.purpose")}</p>
      </article>

      <article>
        <h2 className="text-lg font-semibold text-slate-900">{t("about.rubricTitle")}</h2>
        <p className="mt-1 text-sm text-slate-600">
          <Link to="/" className="text-indigo-600 hover:underline">
            {t("guide.scoring.rubric")} →
          </Link>
        </p>
        <ul
          aria-label={t("about.rubricTitle")}
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {RUBRIC_DIMENSIONS.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span className="text-slate-800">
                {t(
                  d.id === "project_copy_documentation"
                    ? "rubric.project_copy"
                    : d.id === "ai_agent_integration"
                      ? "rubric.ai_agent"
                      : `rubric.${d.id.split("_")[0]}`,
                )}
              </span>
              <span className="font-mono text-slate-600">{d.weight}%</span>
            </li>
          ))}
        </ul>
      </article>

      <article className="prose prose-slate max-w-none">
        <h2 className="text-lg font-semibold text-slate-900">{t("about.brainstormingTitle")}</h2>
        <p className="leading-relaxed text-slate-700">{t("about.brainstorming")}</p>
        <p className="mt-2 text-sm text-slate-600">
          <Link to="/prompt" className="text-indigo-600 hover:underline">
            {t("nav.prompt")} →
          </Link>
        </p>
      </article>
    </section>
  );
}
