// Language toggle. Flips the i18next language, persists to
// localStorage.cookbook.lang, and reflects the new value on
// <html lang>. AC-8 expands the key set; this component only needs
// to know how to switch between en and zh.
import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES, persistLocale, type Locale } from "../i18n";

export function LangToggle(): JSX.Element {
  const { i18n, t } = useTranslation();
  const current = (i18n.language as Locale) ?? "en";
  const next: Locale = current === "en" ? "zh" : "en";
  return (
    <button
      type="button"
      data-testid="lang-toggle"
      aria-label={t("common.retry")}
      onClick={() => {
        void i18n.changeLanguage(next);
        persistLocale(next);
      }}
      className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {current === "en" ? "中文" : "English"}
    </button>
  );
}

// Re-export the locale list so tests can iterate.
export { SUPPORTED_LOCALES };
