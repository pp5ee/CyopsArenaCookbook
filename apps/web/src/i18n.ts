// i18n bootstrap. Loads en/zh JSON resources, persists the user's
// choice in localStorage, and reflects it on <html lang>. The
// LangToggle component in components/LangToggle.tsx flips the value
// at runtime. AC-8 expands the key set; AC-7 ships the minimum
// surface needed for the four pages and the credits badge to render
// in both locales.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./i18n/en.json";
import zh from "./i18n/zh.json";

export const SUPPORTED_LOCALES = ["en", "zh"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = "cookbook.lang";

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    /* localStorage may be unavailable (private mode, etc.) */
  }
  const nav = window.navigator?.language?.toLowerCase() ?? "";
  if (nav.startsWith("zh")) return "zh";
  return "en";
}

export function persistLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectInitialLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Reflect the initial locale on <html lang> as soon as i18n is ready.
if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.language;
}

export default i18n;
