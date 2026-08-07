import { normalizeDateWindow } from "../options.js";
import type { SourceFetchOptions } from "../types.js";

/** EMMA's four fixed posting windows for the continuing-disclosure feed. */
export type MsrbEmmaPeriod = "Today" | "Yesterday" | "ThisWeek" | "LastWeek";

export interface MsrbEmmaFetchOptions extends SourceFetchOptions {
  /** Explicit EMMA posting window; overrides `since`-based selection. */
  readonly period?: MsrbEmmaPeriod;
}

export const EMMA_BASE_URL = "https://emma.msrb.org";
const DAY_MS = 86_400_000;
/**
 * EMMA posting windows are US-Eastern calendar days. A fixed standard-time
 * offset is close enough here: a DST hour only shifts window boundaries, and
 * boundary overshoot merely over-fetches one extra window.
 */
const EASTERN_OFFSET_MS = 5 * 3_600_000;

/**
 * MSRB EMMA (Electronic Municipal Market Access) continuing-disclosure feed:
 * the market-wide stream of municipal issuer disclosures (rating changes,
 * bond calls, defeasances, financial statements, ...). The JSON endpoint
 * backs emma.msrb.org/MarketActivity/RecentCD and needs no API key, only the
 * Terms-of-Use cookie that `fetchText` attaches for this host.
 */
export function msrbEmmaCdUrl(period: MsrbEmmaPeriod = "Today"): string {
  const url = new URL("/MarketActivity/GetCdData", EMMA_BASE_URL);
  url.searchParams.set("selectedPeriod", period);
  return url.toString();
}

/**
 * EMMA posting windows covering the requested window. Defaults to
 * Today+Yesterday for a fresh-news stream; a `since` bound widens the
 * selection. EMMA offers nothing older than `LastWeek`, so older bounds
 * still map to it, and over-fetch is trimmed by local date filtering.
 */
export function msrbEmmaPeriods(
  options: Pick<MsrbEmmaFetchOptions, "period" | "since"> = {},
  nowMs = Date.now(),
): readonly MsrbEmmaPeriod[] {
  if (options.period) return [options.period];
  const { sinceMs } = normalizeDateWindow(
    options.since !== undefined ? { since: options.since } : {},
  );
  if (sinceMs === undefined) return ["Today", "Yesterday"];

  const easternDayIndex = Math.floor((nowMs - EASTERN_OFFSET_MS) / DAY_MS);
  const startOfTodayMs = easternDayIndex * DAY_MS + EASTERN_OFFSET_MS;
  const startOfYesterdayMs = startOfTodayMs - DAY_MS;
  // 1970-01-01 was a Thursday; +4 rebases the index so Sunday === 0.
  const startOfWeekMs = startOfTodayMs - ((easternDayIndex + 4) % 7) * DAY_MS;

  const periods: MsrbEmmaPeriod[] = ["Today"];
  if (sinceMs < startOfTodayMs) periods.push("Yesterday");
  if (sinceMs < startOfYesterdayMs && startOfWeekMs < startOfYesterdayMs) periods.push("ThisWeek");
  if (sinceMs < startOfWeekMs) periods.push("LastWeek");
  return periods;
}
