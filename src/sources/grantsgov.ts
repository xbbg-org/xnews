import { postJson } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import {
  GRANTS_GOV_DEFAULT_ROWS,
  GRANTS_GOV_SEARCH_PAGE_URL,
  GRANTS_GOV_SEARCH_URL,
  grantsGovOpportunityUrl,
  grantsGovSearchBody,
} from "./grantsgov.urls.js";

const GRANTS_GOV_SHAPE_ERROR = "unexpected Grants.gov search response shape";
const GRANTS_GOV_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export {
  GRANTS_GOV_DEFAULT_ROWS,
  GRANTS_GOV_DETAIL_BASE_URL,
  GRANTS_GOV_SEARCH_PAGE_URL,
  GRANTS_GOV_SEARCH_URL,
  grantsGovOpportunityUrl,
  grantsGovSearchBody,
} from "./grantsgov.urls.js";
export type { GrantsGovSearchBody, GrantsGovSearchBodyOptions } from "./grantsgov.urls.js";

export interface GrantsGovOpportunityRow {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly agencyCode?: string;
  readonly agency?: string;
  readonly openDate: string;
  readonly closeDate?: string;
  readonly oppStatus?: string;
  readonly url: string;
}

export interface GrantsGovFetchOptions extends SourceFetchOptions {
  readonly keyword?: string;
}

/** Fetches currently posted Grants.gov opportunities as typed rows. */
export async function fetchGrantsGovOpportunities(
  options: GrantsGovFetchOptions = {},
): Promise<GrantsGovOpportunityRow[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = grantsGovSearchBody({
    rows: limit ?? GRANTS_GOV_DEFAULT_ROWS,
    ...(options.keyword !== undefined ? { keyword: options.keyword } : {}),
  });
  return parseGrantsGovOpportunities(await postJson(GRANTS_GOV_SEARCH_URL, body, options));
}

export function grantsGovDataSource(
  options: GrantsGovFetchOptions = {},
): DataSource<GrantsGovOpportunityRow> {
  return {
    provider: "grants-gov",
    dataset: "opportunities",
    requestUrls: () => [GRANTS_GOV_SEARCH_URL],
    fetchRelease: async (fetchOptions = {}) => {
      const combined: GrantsGovFetchOptions = { ...options, ...fetchOptions };
      const rows = await fetchGrantsGovOpportunities(combined);
      const release: DataRelease<GrantsGovOpportunityRow> = {
        provider: "grants-gov",
        dataset: "opportunities",
        asOf: latestOpenDate(rows) ?? new Date().toISOString().slice(0, 10),
        url: GRANTS_GOV_SEARCH_PAGE_URL,
        rows,
      };
      return release;
    },
  };
}

/** Parses Grants.gov search results, omitting opportunities with invalid dates. */
export function parseGrantsGovOpportunities(body: string): GrantsGovOpportunityRow[] {
  const payload = parseJsonRecord(body, "Grants.gov search");
  const data = payload["data"];
  const oppHits = isRecord(data) ? data["oppHits"] : undefined;
  if (!Array.isArray(oppHits)) {
    throw new Error(GRANTS_GOV_SHAPE_ERROR);
  }

  const records = recordArray(oppHits);
  if (oppHits.length > 0 && records.length === 0) {
    throw new Error(GRANTS_GOV_SHAPE_ERROR);
  }
  const rows: GrantsGovOpportunityRow[] = [];
  let recognizableRecords = 0;
  for (const record of records) {
    const id = stringField(record, "id")?.trim();
    const number = stringField(record, "number")?.trim();
    const title = stringField(record, "title")?.trim();
    if (!id || !number || !title) continue;
    recognizableRecords += 1;

    const rawOpenDate = stringField(record, "openDate")?.trim();
    const openDate = rawOpenDate ? parseGrantsGovDate(rawOpenDate) : undefined;
    if (!openDate) continue;

    const rawCloseDate = stringField(record, "closeDate")?.trim();
    const closeDate = rawCloseDate ? parseGrantsGovDate(rawCloseDate) : undefined;
    if (rawCloseDate && !closeDate) continue;

    const agencyCode = stringField(record, "agencyCode")?.trim();
    const agency = stringField(record, "agency")?.trim();
    const oppStatus = stringField(record, "oppStatus")?.trim();
    rows.push({
      id,
      number,
      title,
      ...(agencyCode ? { agencyCode } : {}),
      ...(agency ? { agency } : {}),
      openDate,
      ...(closeDate ? { closeDate } : {}),
      ...(oppStatus ? { oppStatus } : {}),
      url: grantsGovOpportunityUrl(id),
    });
  }
  if (records.length > 0 && recognizableRecords === 0) {
    throw new Error(GRANTS_GOV_SHAPE_ERROR);
  }
  return rows;
}

/** Parses the publisher's fixed-width US date without relying on runtime heuristics. */
export function parseGrantsGovDate(value: string): string | undefined {
  const match = GRANTS_GOV_DATE_PATTERN.exec(value);
  if (!match) return undefined;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function latestOpenDate(rows: readonly GrantsGovOpportunityRow[]): string | undefined {
  let latest: string | undefined;
  for (const row of rows) {
    if (latest === undefined || row.openDate > latest) latest = row.openDate;
  }
  return latest;
}
