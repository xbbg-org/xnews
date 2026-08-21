import { fetchText } from "../http.js";
import { parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import { UNHCR_POPULATION_API_URL, unhcrPopulationUrl } from "./unhcr.urls.js";
import type { UnhcrPopulationUrlOptions } from "./unhcr.urls.js";

const UNHCR_SHAPE_ERROR = "unexpected UNHCR population response shape";
const OTHER_DISPLACEMENT_FIELDS = ["oip", "stateless", "ooc", "hst"] as const;

export {
  UNHCR_POPULATION_API_URL,
  UNHCR_POPULATION_DEFAULT_LIMIT,
  unhcrPopulationUrl,
} from "./unhcr.urls.js";
export type { UnhcrPopulationUrlOptions } from "./unhcr.urls.js";

export interface UnhcrDisplacementRow {
  readonly year?: number;
  readonly originName?: string;
  readonly originIso3?: string;
  readonly asylumName?: string;
  readonly asylumIso3?: string;
  readonly refugees?: number;
  readonly asylumSeekers?: number;
  readonly idps?: number;
  readonly others?: number;
}

export interface UnhcrFetchOptions extends SourceFetchOptions {
  /** Annual UNHCR reporting year; defaults to the previous UTC calendar year. */
  readonly year?: number;
}

/** Fetches one annual UNHCR population table. */
export async function fetchUnhcrDisplacement(
  options: UnhcrFetchOptions = {},
): Promise<UnhcrDisplacementRow[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const year = options.year ?? new Date().getUTCFullYear() - 1;
  const body = await fetchText(unhcrPopulationUrl(year, unhcrUrlOptions(options)), options);
  const rows = parseUnhcrDisplacement(body);
  return limit === undefined ? rows : rows.slice(0, limit);
}

/** Parses UNHCR's `items` array without performing I/O. */
export function parseUnhcrDisplacement(body: string): UnhcrDisplacementRow[] {
  const payload = parseJsonRecord(body, "UNHCR population");
  const items = payload["items"];
  if (!Array.isArray(items)) throw new Error(UNHCR_SHAPE_ERROR);
  const records = recordArray(items);
  const rows: UnhcrDisplacementRow[] = [];
  for (const record of records) {
    const originName = cleanStringField(record, "coo_name");
    const originIso3 = cleanStringField(record, "coo_iso");
    const asylumName = cleanStringField(record, "coa_name");
    const asylumIso3 = cleanStringField(record, "coa_iso");
    if (!originName && !originIso3 && !asylumName && !asylumIso3) continue;

    const year = integerField(record, "year");
    const refugees = numericField(record, "refugees");
    const asylumSeekers = numericField(record, "asylum_seekers");
    const idps = numericField(record, "idps");
    const others = numericSum(record, OTHER_DISPLACEMENT_FIELDS);
    rows.push({
      ...(year !== undefined ? { year } : {}),
      ...(originName !== undefined ? { originName } : {}),
      ...(originIso3 !== undefined ? { originIso3 } : {}),
      ...(asylumName !== undefined ? { asylumName } : {}),
      ...(asylumIso3 !== undefined ? { asylumIso3 } : {}),
      ...(refugees !== undefined ? { refugees } : {}),
      ...(asylumSeekers !== undefined ? { asylumSeekers } : {}),
      ...(idps !== undefined ? { idps } : {}),
      ...(others !== undefined ? { others } : {}),
    });
  }
  if (items.length > 0 && rows.length === 0) throw new Error(UNHCR_SHAPE_ERROR);
  return rows;
}

/** Binds UNHCR's annual population dataset to the data lane. */
export function unhcrDataSource(options: UnhcrFetchOptions = {}): DataSource<UnhcrDisplacementRow> {
  return {
    provider: "unhcr-displacement",
    dataset: "population",
    requestUrls: (fetchOptions = {}) => {
      const merged = { ...options, ...fetchOptions };
      if (normalizeLimit(merged.limit) === 0) return [];
      const year = merged.year ?? new Date().getUTCFullYear() - 1;
      return [unhcrPopulationUrl(year, unhcrUrlOptions(merged))];
    },
    fetchRelease: (fetchOptions = {}) => fetchUnhcrRelease({ ...options, ...fetchOptions }),
  };
}

async function fetchUnhcrRelease(
  options: UnhcrFetchOptions & DataFetchOptions,
): Promise<DataRelease<UnhcrDisplacementRow> | undefined> {
  const year = options.year ?? new Date().getUTCFullYear() - 1;
  const rows = await fetchUnhcrDisplacement({ ...options, year });
  if (rows.length === 0) return undefined;
  // UNHCR population tables are annual, so calendar year-end is their canonical as-of date.
  const asOf = `${year}-12-31`;
  if (options.ifNewerThan !== undefined && options.ifNewerThan >= asOf) return undefined;
  return {
    provider: "unhcr-displacement",
    dataset: "population",
    asOf,
    url: UNHCR_POPULATION_API_URL,
    rows,
  };
}

function unhcrUrlOptions(options: UnhcrFetchOptions): UnhcrPopulationUrlOptions {
  return options.limit === undefined ? {} : { limit: options.limit };
}

function cleanStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(record, key)?.trim();
  return value ? value : undefined;
}

function integerField(record: Record<string, unknown>, key: string): number | undefined {
  const value = numericField(record, key);
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

function numericField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numericSum(
  record: Record<string, unknown>,
  fields: readonly string[],
): number | undefined {
  let total = 0;
  for (const field of fields) {
    const value = numericField(record, field);
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}
