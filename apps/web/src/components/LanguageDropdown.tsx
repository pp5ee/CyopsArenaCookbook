// LanguageDropdown — Globe icon dropdown for en/zh switching.
// Replaces the old LangToggle button. Cyberpunk styled.
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { persistLocale, type Locale } from "../i18n";

export function LanguageDropdown(): JSX.Element {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = i18n.language as Locale;

  const options: { value: Locale; label: string; flag: string }[] = [
    { value: "en", label: "English", flag: "🇺🇸" },
    { value: "zh", label: "中文", flag: "🇨🇳" },
  ];

  const switchLang = (lang: Locale) => {
    i18n.changeLanguage(lang);
    persistLocale(lang);
    setOpen(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentOption = options.find((o) => o.value === current) ?? options[0];

  return (
    <div ref={ref} className="relative" data-testid="lang-dropdown">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Switch language"
        data-testid="lang-dropdown-btn"
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-arena-muted
                   transition-colors hover:bg-arena-surface-hover hover:text-arena-text
                   border border-transparent hover:border-arena-border"
      >
        <span className="text-base" role="img" aria-hidden="true">
          🌐
        </span>
        <span className="hidden sm:inline">{currentOption.label}</span>
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          data-testid="lang-dropdown-menu"
          className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-md
                     border border-arena-border bg-arena-surface shadow-lg
                     shadow-cyber-blue/10"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => switchLang(opt.value)}
              data-testid={`lang-${opt.value}`}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors
                ${current === opt.value
                  ? "bg-arena-accent/10 text-arena-accent"
                  : "text-arena-muted hover:bg-arena-surface-hover hover:text-arena-text"
                }`}
            >
              <span role="img" aria-hidden="true">{opt.flag}</span>
              {opt.label}
              {current === opt.value && (
                <svg className="ml-auto h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
