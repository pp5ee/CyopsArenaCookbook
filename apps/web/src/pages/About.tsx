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
      <h1 className="text-2xl font-semibold text-arena-text">{t("about.title")}</h1>

      <article className="max-w-none space-y-3">
        <h2 className="text-lg font-semibold text-arena-text">{t("about.purposeTitle")}</h2>
        <p className="leading-relaxed text-arena-muted">{t("about.purpose")}</p>
      </article>

      <article>
        <h2 className="text-lg font-semibold text-arena-text">{t("about.rubricTitle")}</h2>
        <p className="mt-1 text-sm text-arena-muted">
          <Link to="/" className="text-arena-accent hover:underline">
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
              className="flex items-center justify-between rounded border border-arena-border bg-arena-surface px-3 py-2 text-sm"
            >
              <span className="text-arena-text">{t(d.titleKey)}</span>
              <span className="font-mono text-arena-muted">{d.weight}%</span>
            </li>
          ))}
        </ul>
      </article>

      <article className="max-w-none space-y-3">
        <h2 className="text-lg font-semibold text-arena-text">{t("about.brainstormingTitle")}</h2>
        <p className="leading-relaxed text-arena-muted">{t("about.brainstorming")}</p>
        <p className="mt-2 text-sm text-arena-muted">
          <Link to="/prompt" className="text-arena-accent hover:underline">
            {t("nav.prompt")} →
          </Link>
        </p>
      </article>
    </section>
  );
}
