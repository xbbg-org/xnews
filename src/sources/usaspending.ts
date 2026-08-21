import { postJson } from "../http.js";
import { parseJsonRecord, recordArray, numberField, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import {
  USASPENDING_AWARDS_URL,
  USASPENDING_DEFAULT_LIMIT,
  USASPENDING_SEARCH_URL,
  usaSpendingAwardUrl,
  usaSpendingDateWindow,
  usaSpendingSearchBody,
} from "./usaspending.urls.js";
import type { UsaSpendingDateWindow } from "./usaspending.urls.js";

const USASPENDING_SHAPE_ERROR = "unexpected USAspending award search response shape";

export {
  USASPENDING_AWARD_BASE_URL,
  USASPENDING_AWARD_FIELDS,
  USASPENDING_AWARD_TYPE_CODES,
  USASPENDING_AWARDS_URL,
  USASPENDING_DEFAULT_LIMIT,
  USASPENDING_SEARCH_URL,
  usaSpendingAwardUrl,
  usaSpendingDateWindow,
  usaSpendingSearchBody,
} from "./usaspending.urls.js";
export type {
  UsaSpendingDateWindow,
  UsaSpendingDateWindowOptions,
  UsaSpendingSearchBody,
  UsaSpendingSearchBodyOptions,
} from "./usaspending.urls.js";

export interface UsaSpendingAwardRow {
  readonly awardId: string;
  readonly recipientName: string;
  readonly amount?: number;
  readonly awardingAgency?: string;
  readonly awardType?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly description?: string;
  readonly url: string;
}

export interface UsaSpendingFetchOptions extends SourceFetchOptions {
  readonly page?: number;
}

/** Fetches one USAspending award-search page as typed rows. */
export async function fetchUsaSpendingAwards(
  options: UsaSpendingFetchOptions = {},
): Promise<UsaSpendingAwardRow[]> {
  const window = usaSpendingDateWindow(options);
  return requestUsaSpendingAwards(window, options);
}

export function usaSpendingDataSource(
  options: UsaSpendingFetchOptions = {},
): DataSource<UsaSpendingAwardRow> {
  return {
    provider: "usaspending",
    dataset: "awards",
    requestUrls: () => [USASPENDING_SEARCH_URL],
    fetchRelease: async (fetchOptions = {}) => {
      const combined: UsaSpendingFetchOptions = { ...options, ...fetchOptions };
      const window = usaSpendingDateWindow(combined);
      const rows = await requestUsaSpendingAwards(window, combined);
      const release: DataRelease<UsaSpendingAwardRow> = {
        provider: "usaspending",
        dataset: "awards",
        asOf: window.endDate,
        url: USASPENDING_AWARDS_URL,
        rows,
      };
      return release;
    },
  };
}

/** Parses a USAspending award-search JSON body. Pure and network-free. */
export function parseUsaSpendingAwards(body: string): UsaSpendingAwardRow[] {
  const payload = parseJsonRecord(body, "USAspending award search");
  const results = payload["results"];
  if (!Array.isArray(results)) throw new Error(USASPENDING_SHAPE_ERROR);

  const records = recordArray(results);
  if (results.length > 0 && records.length === 0) {
    throw new Error(USASPENDING_SHAPE_ERROR);
  }
  const rows: UsaSpendingAwardRow[] = [];
  for (const record of records) {
    const awardId = stringField(record, "Award ID")?.trim();
    const recipientName = stringField(record, "Recipient Name")?.trim();
    const generatedInternalId = stringField(record, "generated_internal_id")?.trim();
    if (!awardId || !recipientName || !generatedInternalId) continue;

    const amount = numberField(record, "Award Amount");
    const awardingAgency = stringField(record, "Awarding Agency")?.trim();
    const awardType = stringField(record, "Award Type")?.trim();
    const startDate = stringField(record, "Start Date")?.trim();
    const endDate = stringField(record, "End Date")?.trim();
    const description = stringField(record, "Description")?.trim();
    rows.push({
      awardId,
      recipientName,
      ...(amount !== undefined ? { amount } : {}),
      ...(awardingAgency ? { awardingAgency } : {}),
      ...(awardType ? { awardType } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(description ? { description } : {}),
      url: usaSpendingAwardUrl(generatedInternalId),
    });
  }

  if (records.length > 0 && rows.length === 0) throw new Error(USASPENDING_SHAPE_ERROR);
  return rows;
}

async function requestUsaSpendingAwards(
  window: UsaSpendingDateWindow,
  options: UsaSpendingFetchOptions,
): Promise<UsaSpendingAwardRow[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = usaSpendingSearchBody({
    since: window.startDate,
    until: window.endDate,
    page: options.page ?? 1,
    limit: limit ?? USASPENDING_DEFAULT_LIMIT,
  });
  return parseUsaSpendingAwards(await postJson(USASPENDING_SEARCH_URL, body, options));
}
