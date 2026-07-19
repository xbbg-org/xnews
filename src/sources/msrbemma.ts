import { fetchText } from "../http";
import { parseJsonRecord, recordArray, stringField } from "../json";
import { normalizeDateWindow, normalizeLimit } from "../options";
import { stableId, toAbsoluteUrl } from "../text";
import { subjectMatcher, type SubjectMatchTerms } from "./match";
import type { NewsItem, SourceFetchOptions } from "../types";

/** EMMA's four fixed posting windows for the continuing-disclosure feed. */
export type MsrbEmmaPeriod = "Today" | "Yesterday" | "ThisWeek" | "LastWeek";

export interface MsrbEmmaFetchOptions extends SourceFetchOptions {
  /** Explicit EMMA posting window; overrides `since`-based selection. */
  readonly period?: MsrbEmmaPeriod;
}

const EMMA_BASE_URL = "https://emma.msrb.org";
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

export async function fetchMsrbEmmaDisclosures(
  terms: SubjectMatchTerms | undefined,
  options: MsrbEmmaFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const bodies = await Promise.all(
    msrbEmmaPeriods(options).map(async (period) => fetchText(msrbEmmaCdUrl(period), options)),
  );

  // ThisWeek/LastWeek windows overlap Today/Yesterday; dedupe across bodies.
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const body of bodies) {
    for (const item of parseMsrbEmmaDisclosures(body, terms ? { terms } : {})) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return limit !== undefined ? items.slice(0, limit) : items;
}

export function parseMsrbEmmaDisclosures(
  body: string,
  options: { terms?: SubjectMatchTerms; limit?: number } = {},
): NewsItem[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const payload = parseJsonRecord(body, "MSRB EMMA");
  const matches = options.terms ? subjectMatcher(options.terms) : undefined;
  const items: NewsItem[] = [];
  for (const row of recordArray(payload["data"])) {
    const issuer = stringField(row, "IssuerName")?.trim();
    const submissionId = stringField(row, "SubmissionId")?.trim();
    if (!issuer || !submissionId) continue;

    const description =
      stringField(row, "DisclosureDescriptions")?.trim() ||
      stringField(row, "DisclosureCategories")?.trim() ||
      "Continuing Disclosure";
    const detailsPath = stringField(row, "CdDetailsUrl")?.trim().replace("{0}", submissionId);
    const url = detailsPath
      ? toAbsoluteUrl(detailsPath, `${EMMA_BASE_URL}/MarketActivity/`)
      : `${EMMA_BASE_URL}/MarketActivity/ContinuingDisclosureDetails/${submissionId}`;
    const publishedAtText = stringField(row, "PostingDateTime");
    const publishedAt = parseDotNetDate(publishedAtText);

    let title = `${issuer}: ${description}`;
    if (row["IsModified"] === true) title += " (Modified)";
    if (row["ConfirmationFlag"] === false) title += " (Unconfirmed)";

    const item: NewsItem = {
      id: stableId(["msrb-emma", submissionId, stringField(row, "DocumentId") ?? "", issuer]),
      provider: "msrb-emma",
      kind: "filing",
      title,
      url,
      canonicalUrl: url,
      source: "MSRB EMMA",
      companyName: issuer,
      ...(publishedAt ? { publishedAt } : {}),
      ...(publishedAtText ? { publishedAtText } : {}),
    };
    if (matches && !matches(item)) continue;

    items.push(item);
    if (limit !== undefined && items.length >= limit) break;
  }
  return items;
}

/** Parses the .NET JSON date wrapper, e.g. `/Date(1784431894000)/`. */
function parseDotNetDate(value: string | undefined): string | undefined {
  const match = value?.match(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//);
  if (!match?.[1]) return undefined;
  const timestamp = Number(match[1]);
  return Number.isSafeInteger(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : undefined;
}
