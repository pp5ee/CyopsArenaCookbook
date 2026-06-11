// Language toggle. Flips the i18next language, persists to
// localStorage.cookbook.lang, and reflects the new value on
// <html lang>. The aria-label is a dedicated key
// (common.toggleLanguage) so screen readers announce "Switch
// language" / "切换语言" instead of the button's visible text.
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
      aria-label={t("common.toggleLanguage")}
      onClick={() => {
        void i18n.changeLanguage(next);
        persistLocale(next);
      }}
      className="rounded border border-arena-border bg-arena-surface px-2 py-1 text-sm font-medium text-arena-muted hover:bg-arena-surface-hover hover:text-arena-text"
    >
      {current === "en" ? "中文" : "English"}
    </button>
  );
}

// Re-export the locale list so tests can iterate.
export { SUPPORTED_LOCALES };
