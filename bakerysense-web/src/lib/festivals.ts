/**
 * Festival / cultural-event lookup. Static data — bundled with the worker
 * so there's no fetch at request time. Per-locale calendars; the branch's
 * `locale` column drives the lookup.
 *
 * The dates are deterministic at the year boundary so we hard-code multiple
 * years; new years are added by appending entries below. For lunar
 * calendars (Chinese New Year, Hari Raya, Deepavali, mid-Autumn) the dates
 * shift each year and must be sourced from an authoritative calendar
 * (e.g. https://hk.timeanddate.com/calendar/). The list below is a
 * curated minimum useful set covering the markets in the demo.
 *
 * Output is keyed to the V2 feature registry IDs:
 *   is_chinese_new_year, is_hari_raya, is_christmas, is_deepavali,
 *   is_mid_autumn, is_pre_festival_eve, is_school_holiday.
 */

export type FestivalKey =
  | "is_chinese_new_year"
  | "is_hari_raya"
  | "is_christmas"
  | "is_deepavali"
  | "is_mid_autumn"
  | "is_school_holiday";

interface Festival {
  key: FestivalKey;
  /** Inclusive start ISO date. */
  start: string;
  /** Inclusive end ISO date. */
  end: string;
  /** Locales where this festival applies. Use BCP-47 language-region or
   *  bare region prefixes; matched left-to-right by prefix. */
  locales: string[];
}

const FESTIVALS: Festival[] = [
  // Chinese New Year — SG/MY/HK/CN
  { key: "is_chinese_new_year", start: "2026-02-17", end: "2026-02-18", locales: ["zh", "en-SG", "en-MY", "ms"] },
  { key: "is_chinese_new_year", start: "2027-02-06", end: "2027-02-07", locales: ["zh", "en-SG", "en-MY", "ms"] },

  // Hari Raya Aidilfitri — SG/MY/ID
  { key: "is_hari_raya", start: "2026-03-20", end: "2026-03-21", locales: ["ms", "id", "en-SG", "en-MY"] },
  { key: "is_hari_raya", start: "2027-03-09", end: "2027-03-10", locales: ["ms", "id", "en-SG", "en-MY"] },

  // Deepavali — SG/MY/IN
  { key: "is_deepavali", start: "2026-11-08", end: "2026-11-08", locales: ["ta", "hi", "en-IN", "en-SG", "en-MY"] },

  // Mid-Autumn — SG/MY/HK/CN
  { key: "is_mid_autumn", start: "2026-09-25", end: "2026-09-25", locales: ["zh", "en-SG", "en-MY"] },

  // Christmas — global
  { key: "is_christmas", start: "2025-12-22", end: "2025-12-26", locales: ["en", "fr", "de", "es", "pt", "it"] },
  { key: "is_christmas", start: "2026-12-22", end: "2026-12-26", locales: ["en", "fr", "de", "es", "pt", "it"] },

  // School holidays (France) — relevant for the French Bakery dataset
  { key: "is_school_holiday", start: "2026-04-13", end: "2026-04-26", locales: ["fr"] },
  { key: "is_school_holiday", start: "2026-07-08", end: "2026-08-31", locales: ["fr"] },
  { key: "is_school_holiday", start: "2026-10-19", end: "2026-11-01", locales: ["fr"] },
  { key: "is_school_holiday", start: "2026-12-21", end: "2027-01-04", locales: ["fr"] },
];

function localeMatches(festLocales: string[], branchLocale: string): boolean {
  const branchLower = branchLocale.toLowerCase();
  for (const f of festLocales) {
    const fLower = f.toLowerCase();
    if (branchLower === fLower) return true;
    if (branchLower.startsWith(fLower + "-")) return true;
    if (fLower.length <= 3 && branchLower.startsWith(fLower)) return true; // language-only match
  }
  return false;
}

function isInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns 0/1 flags for each festival key applicable to (locale, date),
 * plus `is_pre_festival_eve` (the day before any matched festival start)
 * and `days_until_holiday` (a soft signal — capped at 30).
 */
export function festivalFeatures(locale: string | null, date: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!locale) return out;
  let preEve = 0;
  let daysUntil = 30;
  for (const f of FESTIVALS) {
    if (!localeMatches(f.locales, locale)) continue;
    if (isInRange(date, f.start, f.end)) out[f.key] = 1;
    if (date === dayBefore(f.start)) preEve = 1;
    if (date < f.start) {
      const delta = Math.floor(
        (new Date(`${f.start}T00:00:00Z`).getTime() -
          new Date(`${date}T00:00:00Z`).getTime()) / 86400_000,
      );
      if (delta < daysUntil) daysUntil = delta;
    }
  }
  if (preEve) out.is_pre_festival_eve = 1;
  out.days_until_holiday = daysUntil;
  return out;
}

export const __test_internals__ = { FESTIVALS, localeMatches, isInRange, dayBefore };
