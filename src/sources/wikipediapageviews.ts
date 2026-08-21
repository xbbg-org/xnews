import { XnewsFetchError, fetchText } from "../http.js";
import { isRecord, numberField, parseJsonRecord, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import type { DataSource, SourceFetchOptions } from "../types.js";
import {
  WIKIPEDIA_EXCLUDED_PREFIXES,
  wikipediaPageviewsDate,
  wikipediaPageviewsUrl,
} from "./wikipediapageviews.urls.js";
import type { WikipediaPageviewsUrlOptions } from "./wikipediapageviews.urls.js";

const WIKIPEDIA_SHAPE_ERROR = "unexpected Wikimedia pageviews response shape";
const WIKIPEDIA_MAIN_PAGE = "Main_Page";

export {
  WIKIPEDIA_DEFAULT_ACCESS,
  WIKIPEDIA_DEFAULT_PROJECT,
  WIKIPEDIA_EXCLUDED_PREFIXES,
  WIKIPEDIA_PAGEVIEWS_API_BASE_URL,
  wikipediaPageviewsDate,
  wikipediaPageviewsUrl,
} from "./wikipediapageviews.urls.js";
export type {
  WikipediaPageviewsAccess,
  WikipediaPageviewsUrlOptions,
} from "./wikipediapageviews.urls.js";

export interface WikipediaPageviewRow {
  readonly article: string;
  readonly title: string;
  readonly views: number;
  readonly rank: number;
  readonly url: string;
}

export interface WikipediaPageviewsParseOptions {
  /**
   * Includes navigation and project namespaces. Exclusion is the default because pages such as
   * Main_Page and Special:Search otherwise overwhelm the ranking as an attention signal.
   */
  readonly includeNonArticles?: boolean;
  readonly limit?: number;
}

export type WikipediaPageviewsOptions = SourceFetchOptions &
  WikipediaPageviewsUrlOptions &
  WikipediaPageviewsParseOptions;

interface WikipediaPageviewsRequest {
  readonly asOf: string;
  readonly url: string;
}

/**
 * Fetches the requested top-article rows. Resolves an empty list when the day
 * is not published; use `wikipediaPageviewsDataSource` when the distinction
 * from a published empty day matters, because its `fetchRelease` resolves
 * `undefined` for that case.
 */
export async function fetchWikipediaTopArticles(
  options: WikipediaPageviewsOptions = {},
): Promise<WikipediaPageviewRow[]> {
  if (normalizeLimit(options.limit) === 0) return [];
  const resolved = await resolvePublishedPageviews(options);
  return resolved === undefined ? [] : parseWikipediaPageviews(resolved.body, options);
}

/**
 * Binds Wikimedia's daily ranking to the data lane. Wikimedia normally publishes with a lag, so
 * HTTP 404 resolves `undefined` and becomes lane status `empty` rather than a transport error.
 * A successfully published payload with zero articles remains a dated release with empty rows.
 */
export function wikipediaPageviewsDataSource(
  options: WikipediaPageviewsOptions = {},
): DataSource<WikipediaPageviewRow> {
  return {
    provider: "wikipedia-pageviews",
    dataset: "top-articles",
    requestUrls: (fetchOptions = {}) => {
      const combined = { ...options, ...fetchOptions };
      if (normalizeLimit(combined.limit) === 0) return [];
      return [wikipediaPageviewsRequest(combined).url];
    },
    fetchRelease: async (fetchOptions = {}) => {
      const combined = { ...options, ...fetchOptions };
      if (normalizeLimit(combined.limit) === 0) return undefined;
      const resolved = await resolvePublishedPageviews(combined);
      if (resolved === undefined) return undefined;
      return {
        provider: "wikipedia-pageviews",
        dataset: "top-articles",
        asOf: resolved.asOf,
        url: resolved.url,
        rows: parseWikipediaPageviews(resolved.body, combined),
      };
    },
  };
}

/** Parses Wikimedia's daily top-page response into article attention rows. Pure and network-free. */
export function parseWikipediaPageviews(
  body: string,
  options: WikipediaPageviewsParseOptions = {},
): WikipediaPageviewRow[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const payload = parseJsonRecord(body, "Wikimedia pageviews");
  const itemValues = payload["items"];
  if (!Array.isArray(itemValues)) throw new Error(WIKIPEDIA_SHAPE_ERROR);

  const rows: WikipediaPageviewRow[] = [];
  let recognizedItem = itemValues.length === 0;
  for (const itemValue of itemValues) {
    if (!isRecord(itemValue)) continue;
    const project = stringField(itemValue, "project")?.trim();
    const articleValues = itemValue["articles"];
    if (!project || !Array.isArray(articleValues)) continue;
    recognizedItem = true;

    for (const articleValue of articleValues) {
      if (!isRecord(articleValue)) continue;
      const article = stringField(articleValue, "article")?.trim();
      const views = numberField(articleValue, "views");
      const rank = numberField(articleValue, "rank");
      if (!article || views === undefined || rank === undefined) continue;
      if (
        !options.includeNonArticles &&
        (article === WIKIPEDIA_MAIN_PAGE ||
          WIKIPEDIA_EXCLUDED_PREFIXES.some((prefix) => article.startsWith(prefix)))
      ) {
        continue;
      }

      rows.push({
        article,
        title: article.replaceAll("_", " "),
        views,
        rank,
        url: `https://${project}/wiki/${encodeURIComponent(article)}`,
      });
      if (limit !== undefined && rows.length >= limit) return rows;
    }
  }

  if (!recognizedItem) throw new Error(WIKIPEDIA_SHAPE_ERROR);
  return rows;
}

function wikipediaPageviewsRequest(
  options: WikipediaPageviewsUrlOptions,
): WikipediaPageviewsRequest {
  const asOf = wikipediaPageviewsDate(options.date);
  return { asOf, url: wikipediaPageviewsUrl({ ...options, date: asOf }) };
}

async function fetchWikipediaPageviewsBody(
  url: string,
  options: SourceFetchOptions,
): Promise<string | undefined> {
  try {
    return await fetchText(url, options);
  } catch (error) {
    if (error instanceof XnewsFetchError && error.code === "http_status" && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Resolves the newest published ranking.
 *
 * Wikimedia publishes a day's top list some hours into the following UTC day,
 * so the default target (yesterday) 404s for a large part of every day. When
 * the caller named no explicit `date`, step back one further day rather than
 * reporting nothing — "most recent available" is what a default request means.
 *
 * An explicit `date` is never substituted: a caller asking for one day must
 * not silently receive another.
 */
async function resolvePublishedPageviews(
  options: WikipediaPageviewsOptions,
): Promise<{ readonly asOf: string; readonly url: string; readonly body: string } | undefined> {
  const attempts = options.date === undefined ? 2 : 1;
  let target = wikipediaPageviewsDate(options.date);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const url = wikipediaPageviewsUrl({ ...options, date: target });
    const body = await fetchWikipediaPageviewsBody(url, options);
    if (body !== undefined) return { asOf: target, url, body };
    target = previousIsoDate(target);
  }
  return undefined;
}

function previousIsoDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00.000Z`).toISOString().slice(0, 10) === isoDate
    ? new Date(Date.parse(`${isoDate}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)
    : isoDate;
}
