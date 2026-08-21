import { parsePublishedAt } from "../dates.js";
import { fetchJsonText } from "../http.js";
import { parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, stableId } from "../text.js";
import { subjectMatcher } from "./match.js";
import { WHO_DISEASE_OUTBREAK_NEWS_URL, whoOutbreakUrl } from "./whooutbreaks.urls.js";
import type { SubjectMatchTerms } from "./match.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export {
  WHO_BASE_URL,
  WHO_DISEASE_OUTBREAK_NEWS_URL,
  whoOutbreakUrl,
} from "./whooutbreaks.urls.js";

export async function fetchWhoOutbreaks(
  subject: SubjectMatchTerms = {},
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = await fetchJsonText(WHO_DISEASE_OUTBREAK_NEWS_URL, options);
  return parseWhoOutbreaks(body, subject, limit);
}

/**
 * Parses WHO Disease Outbreak News.
 *
 * WHO's field casing is PascalCase and `FormatedDate` is misspelled upstream —
 * both are matched verbatim here, deliberately. `PublicationDateAndTime` is the
 * precise instant and is preferred; `FormatedDate` is the display fallback.
 *
 * As with OFAC, an empty subject matches everything: the endpoint is already
 * scoped to outbreak notices, so unfiltered is the useful default.
 */
export function parseWhoOutbreaks(
  body: string,
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

  const payload = parseJsonRecord(body, "WHO Disease Outbreak News");
  const items: NewsItem[] = [];
  for (const entry of recordArray(payload["value"])) {
    const title = cleanText(stringField(entry, "Title") ?? "");
    if (title === "") continue;

    const url = whoOutbreakUrl(stringField(entry, "ItemDefaultUrl") ?? "");
    if (url === undefined) continue;

    const summary = cleanText(stringField(entry, "Summary") ?? "");
    if (matches && !matches({ title, ...(summary ? { summary } : {}) })) continue;

    const stamp =
      stringField(entry, "PublicationDateAndTime") ?? stringField(entry, "FormatedDate");
    const publishedAt = stamp ? parsePublishedAt(stamp)?.instant : undefined;
    items.push({
      id: stableId(["who-outbreaks", stringField(entry, "Id") ?? url, title]),
      provider: "who-outbreaks",
      kind: "article",
      title,
      url,
      canonicalUrl: url,
      source: "WHO Disease Outbreak News",
      ...(summary ? { summary } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(stamp ? { publishedAtText: stamp } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  return items;
}
