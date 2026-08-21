import { normalizeDateOnly } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import { CDC_WASTEWATER_DATASET_URL, cdcWastewaterUrl } from "./cdcwastewater.urls.js";
import type { CdcWastewaterUrlOptions } from "./cdcwastewater.urls.js";

const CDC_WASTEWATER_SHAPE_ERROR = "unexpected CDC wastewater response shape";

export {
  CDC_WASTEWATER_BASE_URL,
  CDC_WASTEWATER_DATASET_URL,
  CDC_WASTEWATER_DEFAULT_LIMIT,
  CDC_WASTEWATER_RESOURCE_ID,
  cdcWastewaterUrl,
} from "./cdcwastewater.urls.js";
export type { CdcWastewaterUrlOptions } from "./cdcwastewater.urls.js";

export interface CdcWastewaterRow {
  readonly state: string;
  readonly dateStart?: string;
  readonly dateEnd: string;
  readonly percentile?: number;
  readonly percentChange15d?: number;
  readonly detectionProportion15d?: number;
}

export interface CdcWastewaterFetchOptions extends SourceFetchOptions {
  readonly appToken?: string;
}

/** Fetches CDC NWSS wastewater activity rows, newest reporting windows first. */
export async function fetchCdcWastewater(
  options: CdcWastewaterFetchOptions = {},
): Promise<CdcWastewaterRow[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const body = await fetchText(cdcWastewaterUrl(cdcUrlOptions(options)), options);
  const rows = parseCdcWastewater(body);
  return limit === undefined ? rows : rows.slice(0, limit);
}

/** Parses the CDC Socrata array without performing I/O. */
export function parseCdcWastewater(body: string): CdcWastewaterRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed)) {
    throw new Error("unexpected non-JSON CDC wastewater response");
  }

  const records = parsed.filter(isRecord);
  const rows: CdcWastewaterRow[] = [];
  for (const record of records) {
    const state = stringField(record, "state")?.trim();
    const dateEnd = normalizeStringDate(stringField(record, "date_end"));
    if (!state || dateEnd === undefined) continue;
    const dateStart = normalizeStringDate(stringField(record, "date_start"));
    const percentile = numericField(record, "percentile");
    const percentChange15d = numericField(record, "ptc_15d");
    const detectionProportion15d = numericField(record, "detect_prop_15d");
    rows.push({
      state,
      ...(dateStart !== undefined ? { dateStart } : {}),
      dateEnd,
      ...(percentile !== undefined ? { percentile } : {}),
      ...(percentChange15d !== undefined ? { percentChange15d } : {}),
      ...(detectionProportion15d !== undefined ? { detectionProportion15d } : {}),
    });
  }
  if (parsed.length > 0 && rows.length === 0) throw new Error(CDC_WASTEWATER_SHAPE_ERROR);
  return rows;
}

/** Binds CDC's wastewater-activity dataset to the data lane. */
export function cdcWastewaterDataSource(
  options: CdcWastewaterFetchOptions = {},
): DataSource<CdcWastewaterRow> {
  return {
    provider: "cdc-wastewater",
    dataset: "wastewater-activity",
    requestUrls: (fetchOptions = {}) => {
      const merged = { ...options, ...fetchOptions };
      return normalizeLimit(merged.limit) === 0 ? [] : [cdcWastewaterUrl(cdcUrlOptions(merged))];
    },
    fetchRelease: (fetchOptions = {}) => fetchCdcWastewaterRelease({ ...options, ...fetchOptions }),
  };
}

async function fetchCdcWastewaterRelease(
  options: CdcWastewaterFetchOptions & DataFetchOptions,
): Promise<DataRelease<CdcWastewaterRow> | undefined> {
  const rows = await fetchCdcWastewater(options);
  if (rows.length === 0) return undefined;
  const asOf = rows.reduce(
    (latest, row) => (row.dateEnd > latest ? row.dateEnd : latest),
    rows[0]?.dateEnd ?? "",
  );
  if (options.ifNewerThan !== undefined && options.ifNewerThan >= asOf) return undefined;
  return {
    provider: "cdc-wastewater",
    dataset: "wastewater-activity",
    asOf,
    url: CDC_WASTEWATER_DATASET_URL,
    rows,
  };
}

function cdcUrlOptions(options: CdcWastewaterFetchOptions): CdcWastewaterUrlOptions {
  return {
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.appToken !== undefined ? { appToken: options.appToken } : {}),
  };
}

function normalizeStringDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return normalizeDateOnly(value) ?? undefined;
}

function numericField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
