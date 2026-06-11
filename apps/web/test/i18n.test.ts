// AC-7/AC-8 i18n parity test. Walks every key in en.json and asserts
// that zh.json has the same leaf structure. Catches the
// "added-a-string-to-en-but-forgot-zh" failure mode.
import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import zh from "../src/i18n/zh.json";

function collectKeys(value: unknown, prefix = ""): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object") return [prefix];
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
});
