import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId, toAbsoluteUrl } from "../text.js";
import { subjectMatcher, type SubjectMatchTerms } from "./match.js";
import type { NewsItem } from "../types.js";
import {
  EMMA_BASE_URL,
  msrbEmmaCdUrl,
  msrbEmmaPeriods,
  type MsrbEmmaFetchOptions,
} from "./msrbemma.urls.js";
export { msrbEmmaCdUrl, msrbEmmaPeriods } from "./msrbemma.urls.js";
export type { MsrbEmmaFetchOptions, MsrbEmmaPeriod } from "./msrbemma.urls.js";

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
    const publishedAt = publishedAtText ? parsePublishedAt(publishedAtText)?.instant : undefined;

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
