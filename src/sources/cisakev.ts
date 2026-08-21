import { normalizeDateOnly } from "../dates.js";
import { fetchText } from "../http.js";
import { parseJsonRecord, recordArray, stringArrayField, stringField } from "../json.js";
import type { DataFetchOptions, DataRelease, DataSource } from "../types.js";
import {
  CISA_KEV_CATALOG_URL,
  CISA_KEV_DATASET,
  CISA_KEV_FEED_URL,
  CISA_KEV_PROVIDER,
} from "./cisakev.urls.js";

const CISA_KEV_SHAPE_ERROR = "unexpected CISA KEV response shape";

export {
  CISA_KEV_CATALOG_URL,
  CISA_KEV_DATASET,
  CISA_KEV_FEED_URL,
  CISA_KEV_PROVIDER,
} from "./cisakev.urls.js";

export interface CisaKevRow {
  readonly cveId: string;
  readonly vendorProject: string;
  readonly product: string;
  readonly vulnerabilityName: string;
  readonly dateAdded: string;
  readonly shortDescription: string;
  readonly requiredAction: string;
  readonly dueDate: string;
  /** False means CISA has not identified campaign use, not that use is known to be absent. */
  readonly knownRansomwareUse: boolean;
  readonly notes: string;
  readonly cwes: readonly string[];
  readonly nvdUrl: string;
}

interface ParsedCisaKevCatalog {
  readonly asOf: string;
  readonly rows: CisaKevRow[];
}

/** Fetches the current CISA Known Exploited Vulnerabilities rows. */
export async function fetchCisaKev(options: DataFetchOptions = {}): Promise<CisaKevRow[]> {
  const parsed = parseCisaKevCatalog(await fetchText(CISA_KEV_FEED_URL, options));
  return parsed.rows;
}

/** Parses a CISA KEV catalog body into vulnerability rows. Pure and network-free. */
export function parseCisaKev(body: string): CisaKevRow[] {
  return parseCisaKevCatalog(body).rows;
}

/**
 * Binds CISA KEV to the data lane.
 *
 * `ifNewerThan` cannot avoid the request: CISA exposes the release date and
 * catalog version only inside the downloaded payload. The hint is therefore
 * intentionally ignored rather than presented as a conditional request.
 */
export function cisaKevDataSource(options: DataFetchOptions = {}): DataSource<CisaKevRow> {
  const merged = (fetchOptions: DataFetchOptions): DataFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: CISA_KEV_PROVIDER,
    dataset: CISA_KEV_DATASET,
    requestUrls: () => [CISA_KEV_FEED_URL],
    fetchRelease: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const parsed = parseCisaKevCatalog(await fetchText(CISA_KEV_FEED_URL, combined));
      if (parsed.rows.length === 0) return undefined;
      return {
        provider: CISA_KEV_PROVIDER,
        dataset: CISA_KEV_DATASET,
        asOf: parsed.asOf,
        url: CISA_KEV_CATALOG_URL,
        rows: parsed.rows,
      } satisfies DataRelease<CisaKevRow>;
    },
  };
}

function parseCisaKevCatalog(body: string): ParsedCisaKevCatalog {
  const catalog = parseJsonRecord(body, "CISA KEV");
  const dateReleased = stringField(catalog, "dateReleased");
  const asOf = dateReleased === undefined ? null : normalizeDateOnly(dateReleased);
  const vulnerabilities = catalog["vulnerabilities"];
  if (asOf === null || !Array.isArray(vulnerabilities)) {
    throw new Error(CISA_KEV_SHAPE_ERROR);
  }

  const records = recordArray(vulnerabilities);
  const rows = records.flatMap((record) => {
    const row = parseCisaKevRow(record);
    return row === undefined ? [] : [row];
  });
  if (vulnerabilities.length > 0 && rows.length === 0) {
    throw new Error(CISA_KEV_SHAPE_ERROR);
  }
  return { asOf, rows };
}

function parseCisaKevRow(record: Record<string, unknown>): CisaKevRow | undefined {
  const cveId = stringField(record, "cveID");
  const vendorProject = stringField(record, "vendorProject");
  const product = stringField(record, "product");
  const vulnerabilityName = stringField(record, "vulnerabilityName");
  const dateAdded = stringField(record, "dateAdded");
  const shortDescription = stringField(record, "shortDescription");
  const requiredAction = stringField(record, "requiredAction");
  const dueDate = stringField(record, "dueDate");
  const ransomwareUse = stringField(record, "knownRansomwareCampaignUse");
  const notes = stringField(record, "notes");
  if (
    cveId === undefined ||
    vendorProject === undefined ||
    product === undefined ||
    vulnerabilityName === undefined ||
    dateAdded === undefined ||
    shortDescription === undefined ||
    requiredAction === undefined ||
    dueDate === undefined ||
    ransomwareUse === undefined ||
    notes === undefined
  ) {
    return undefined;
  }

  return {
    cveId,
    vendorProject,
    product,
    vulnerabilityName,
    dateAdded,
    shortDescription,
    requiredAction,
    dueDate,
    knownRansomwareUse: ransomwareUse === "Known",
    notes,
    cwes: stringArrayField(record, "cwes"),
    nvdUrl: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}`,
  };
}
