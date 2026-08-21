import { parsePublishedAt } from "../dates.js";
import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import { cleanText, stableId, toAbsoluteUrl } from "../text.js";
import { subjectMatcher } from "./match.js";
import { OFAC_ACTION_LINK_PATTERN, OFAC_BASE_URL, ofacActionDate } from "./ofac.urls.js";
import { OFAC_RECENT_ACTIONS_URL } from "./ofac.urls.js";
import type { SubjectMatchTerms } from "./match.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export {
  OFAC_ACTION_LINK_PATTERN,
  OFAC_BASE_URL,
  OFAC_RECENT_ACTIONS_URL,
  ofacActionDate,
} from "./ofac.urls.js";

/**
 * Fetches OFAC recent sanctions actions.
 *
 * treasury.gov answers bot-shaped User-Agents with an interstitial, so this
 * announces the browser-shaped string unless the caller overrides it.
 */
export async function fetchOfacActions(
  subject: SubjectMatchTerms = {},
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const html = await fetchText(
    OFAC_RECENT_ACTIONS_URL,
    options,
    options.userAgent ?? BROWSERISH_USER_AGENT,
  );
  return parseOfacActions(html, subject, limit);
}

/**
 * Parses the recent-actions listing.
 *
 * An empty subject matches everything here rather than nothing: unlike the
 * fixed market-news feeds this page is already scoped to one publisher's
 * actions, so an unfiltered read is the useful default.
 */
export function parseOfacActions(
  html: string,
  subject: SubjectMatchTerms = {},
  limit?: number,
): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const hasTerms =
    Boolean(subject.query?.trim()) ||
    Boolean(subject.companyName?.trim()) ||
    Boolean(subject.ticker?.trim());
  const matches = hasTerms ? subjectMatcher(subject) : undefined;

  const items: NewsItem[] = [];
  const seenUrls = new Set<string>();
  const pattern = new RegExp(OFAC_ACTION_LINK_PATTERN, "gi");
  for (const match of html.matchAll(pattern)) {
    const [, path, dateSegment, linkText] = match;
    if (path === undefined || dateSegment === undefined || linkText === undefined) continue;

    const title = cleanText(linkText);
    // OFAC's listing repeats each action as a dated chevron link with no text
    // alongside the titled link; the untitled duplicate carries no information.
    if (title.length < 3) continue;

    const url = toAbsoluteUrl(path, OFAC_BASE_URL);
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    if (matches && !matches({ title })) continue;

    const isoDate = ofacActionDate(dateSegment);
    const publishedAt = isoDate ? parsePublishedAt(isoDate)?.instant : undefined;
    items.push({
      id: stableId(["ofac", path, title]),
      provider: "ofac",
      kind: "press-release",
      title,
      url,
      canonicalUrl: url,
      source: "OFAC Recent Actions",
      eventKind: "regulatory",
      ...(publishedAt ? { publishedAt } : {}),
      ...(isoDate ? { publishedAtText: isoDate } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  return items;
}
