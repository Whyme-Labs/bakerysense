import { describe, expect, it } from "vitest";
import { festivalFeatures, __test_internals__ } from "../../src/lib/festivals";

const { localeMatches, dayBefore } = __test_internals__;

describe("festivals — locale matching", () => {
  it("matches exact BCP-47 codes", () => {
    expect(localeMatches(["en-SG"], "en-SG")).toBe(true);
    expect(localeMatches(["en-SG"], "en-MY")).toBe(false);
  });

  it("matches by language prefix", () => {
    expect(localeMatches(["en"], "en-SG")).toBe(true);
    expect(localeMatches(["zh"], "zh-CN")).toBe(true);
    expect(localeMatches(["fr"], "fr")).toBe(true);
  });

  it("rejects non-matching languages", () => {
    expect(localeMatches(["en"], "fr-FR")).toBe(false);
    expect(localeMatches(["zh"], "ja-JP")).toBe(false);
  });
});

describe("festivals — date helpers", () => {
  it("dayBefore handles month boundaries", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });
});

describe("festivals — feature emission", () => {
  it("returns no flags for a null locale", () => {
    expect(festivalFeatures(null, "2026-12-25")).toEqual({});
  });

  it("flags Christmas for an English-locale branch on 2026-12-25", () => {
    const f = festivalFeatures("en-SG", "2026-12-25");
    expect(f.is_christmas).toBe(1);
  });

  it("does not flag Christmas for a Chinese-locale branch", () => {
    const f = festivalFeatures("zh-CN", "2026-12-25");
    expect(f.is_christmas).toBeUndefined();
  });

  it("flags Chinese New Year for SG on 2026-02-17", () => {
    const f = festivalFeatures("en-SG", "2026-02-17");
    expect(f.is_chinese_new_year).toBe(1);
  });

  it("flags is_pre_festival_eve on the day before a matched festival", () => {
    const f = festivalFeatures("en-SG", "2026-02-16"); // CNY 2026 starts 02-17
    expect(f.is_pre_festival_eve).toBe(1);
  });

  it("emits days_until_holiday counting down to the next matched festival", () => {
    // For French locale on 2026-04-12, the next school holiday starts 2026-04-13.
    const f = festivalFeatures("fr-FR", "2026-04-12");
    expect(f.days_until_holiday).toBe(1);
  });

  it("days_until_holiday caps at 30 when no festival is near", () => {
    // For French-only locale on a date with no nearby French festival, expect cap.
    const f = festivalFeatures("fr-FR", "2026-05-10");
    expect(f.days_until_holiday).toBe(30);
  });

  it("French school holiday window flags correctly", () => {
    const within = festivalFeatures("fr-FR", "2026-04-15");
    const outside = festivalFeatures("fr-FR", "2026-04-30");
    expect(within.is_school_holiday).toBe(1);
    expect(outside.is_school_holiday).toBeUndefined();
  });
});
