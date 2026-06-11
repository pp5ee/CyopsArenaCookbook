// AC-7/AC-8 i18n parity + behavior tests. Walks every key in
// en.json and asserts that zh.json has the same leaf structure.
// Catches the "added-a-string-to-en-but-forgot-zh" failure mode.
// Also verifies the i18n setup helpers (detect + persist + reflect)
// against the public API surface in src/i18n.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../src/i18n/en.json";
import zh from "../src/i18n/zh.json";
import { persistLocale, SUPPORTED_LOCALES } from "../src/i18n";

function collectKeys(value: unknown, prefix = ""): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => collectKeys(v, `${prefix}[${i}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([k, v]) => collectKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("i18n parity", () => {
  it("zh.json has the same key set as en.json", () => {
    const enKeys = collectKeys(en).sort();
    const zhKeys = collectKeys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("en.json has at least the four top-level nav entries", () => {
    expect(Object.keys(en.nav).sort()).toEqual(
      ["about", "guide", "prompt", "vote"].sort(),
    );
  });

  it("en.json and zh.json share the same top-level sections", () => {
    const enTop = Object.keys(en).sort();
    const zhTop = Object.keys(zh).sort();
    expect(zhTop).toEqual(enTop);
  });

  it("common.toggleLanguage exists in both locales (LangToggle aria-label)", () => {
    expect(en.common.toggleLanguage).toBeTruthy();
    expect(zh.common.toggleLanguage).toBeTruthy();
    // They should be different strings (not a copy/paste mistake).
    expect(en.common.toggleLanguage).not.toBe(zh.common.toggleLanguage);
  });

  it("every track entry has a title and blurb in both locales", () => {
    for (const t of SUPPORTED_LOCALES) {
      const locale = t === "en" ? en : zh;
      for (const id of ["ship-a-feature", "mcp-server", "whole-repo-refactor", "resurrection"]) {
        expect(locale.tracks[id as keyof typeof locale.tracks]).toBeDefined();
        const tr = locale.tracks[id as keyof typeof locale.tracks] as { title: string; blurb: string };
        expect(tr.title).toBeTruthy();
        expect(tr.blurb).toBeTruthy();
      }
    }
  });

  it("every rubric dimension has a label in both locales", () => {
    for (const t of SUPPORTED_LOCALES) {
      const locale = t === "en" ? en : zh;
      for (const k of ["implementation", "architecture", "deliverable", "project_copy", "ai_agent", "innovation"]) {
        expect(locale.rubric[k as keyof typeof locale.rubric]).toBeTruthy();
      }
    }
  });
});

describe("persistLocale", () => {
  const STORAGE_KEY = "cookbook.lang";

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "";
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "";
    vi.restoreAllMocks();
  });

  it("writes the locale to localStorage.cookbook.lang", () => {
    persistLocale("zh");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("zh");
    persistLocale("en");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("en");
  });

  it("reflects the locale on <html lang>", () => {
    persistLocale("zh");
    expect(document.documentElement.lang).toBe("zh");
    persistLocale("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("is a no-op when localStorage throws (e.g. private mode)", () => {
    // Swap the setItem method on a local copy so we don't disturb
    // the real localStorage for subsequent tests.
    const realSetItem = window.localStorage.setItem;
    const throwingSetItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    window.localStorage.setItem = throwingSetItem;
    try {
      expect(() => persistLocale("zh")).not.toThrow();
      // <html lang> still updates even if storage fails.
      expect(document.documentElement.lang).toBe("zh");
    } finally {
      window.localStorage.setItem = realSetItem;
    }
  });
});
