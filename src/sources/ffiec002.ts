/**
 * Institution-level FFIEC 002 microdata from the Federal Reserve's National
 * Information Center (NPW). The FFIEC reporting-forms page and CDR bulk page
 * do not list this product; NPW publishes one CSV per RSSD ID and reporting
 * quarter from each institution's Financial Data tab.
 */

import { parseCsvRecords } from "../csv.js";
import { fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import {
  FFIEC_002_PROVIDER_ID,
  ffiec002InstitutionProfileUrl,
  ffiec002ReportingDate,
  ffiec002ReportCsvUrl,
} from "./ffiec002.urls.js";
import type { Ffiec002ReportParams } from "./ffiec002.urls.js";

export {
  FFIEC_002_INSTITUTION_PROFILE_URL,
  FFIEC_002_PROVIDER_ID,
  FFIEC_002_REPORT_CSV_URL,
  FFIEC_002_REPORT_SERIES,
  ffiec002InstitutionProfileUrl,
  ffiec002ReportingDate,
  ffiec002ReportCsvUrl,
} from "./ffiec002.urls.js";
export type { Ffiec002Date, Ffiec002ReportParams } from "./ffiec002.urls.js";

const EXPECTED_HEADER = ["ItemName", "Description", "Value"] as const;
const MDRM_ITEM = /^[A-Z]{4}[A-Z0-9]{4}$/;
const TEXT_ITEM = /^TEXT[A-Z0-9]{4}$/;
const SHAPE_ERROR = "FFIEC 002 CSV has an unexpected payload shape";

/** The three fields NPW publishes verbatim for every report row. */
export interface Ffiec002CsvRow {
  readonly ItemName: string;
  readonly Description: string;
  readonly Value: string;
}

export interface Ffiec002Institution {
  readonly name: string;
  readonly rssdId?: number;
  readonly streetAddress?: string;
  readonly city?: string;
  readonly state?: string;
  readonly zipCode?: string;
  readonly headOfficeName?: string;
  readonly headOfficeCity?: string;
  readonly headOfficeCountry?: string;
  readonly raw: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

/** One public MDRM line item from an institution's quarterly FFIEC 002 filing. */
export interface Ffiec002LineItem {
  readonly reportingDate: string;
  /** Present unless NPW's `ID_RSSD` metadata value could not be coerced. */
  readonly rssdId?: number;
  readonly mdrm: string;
  readonly description: string;
  readonly valueType: "number" | "text";
  readonly rawValue: string;
  readonly numericValue?: number;
  readonly textValue?: string;
  readonly raw: Ffiec002CsvRow;
  readonly warnings: readonly string[];
}

export interface Ffiec002Report {
  readonly reportingDate: string;
  readonly institution: Ffiec002Institution;
  readonly lineItems: readonly Ffiec002LineItem[];
  readonly warnings: readonly string[];
}

export interface Ffiec002ParseOptions {
  readonly reportingDate: string | Date;
  readonly expectedRssdId?: number;
  readonly limit?: number;
}

export interface Ffiec002Release extends DataRelease<Ffiec002LineItem> {
  readonly institution: Ffiec002Institution;
  readonly warnings: readonly string[];
}

/** Parses one NPW institution-level FFIEC 002 CSV. Pure and network-free. */
export function parseFfiec002Report(body: string, options: Ffiec002ParseOptions): Ffiec002Report {
  const reportingDate = ffiec002ReportingDate(options.reportingDate);
  const records = parseCsvRecords(body);
  const header = records[0];
  if (
    header === undefined ||
    header.length !== EXPECTED_HEADER.length ||
    !EXPECTED_HEADER.every((field, index) => header[index] === field)
  ) {
    throw new Error(SHAPE_ERROR);
  }

  const metadata: Record<string, string> = {};
  const lineRows: Ffiec002CsvRow[] = [];
  for (const cells of records.slice(1)) {
    if (cells.length !== EXPECTED_HEADER.length) throw new Error(SHAPE_ERROR);
    const itemName = cells[0] ?? "";
    if (!itemName) throw new Error(SHAPE_ERROR);
    const raw: Ffiec002CsvRow = {
      ItemName: itemName,
      Description: cells[1] ?? "",
      Value: cells[2] ?? "",
    };
    if (MDRM_ITEM.test(itemName)) {
      lineRows.push(raw);
    } else {
      if (Object.hasOwn(metadata, itemName)) throw new Error(SHAPE_ERROR);
      metadata[itemName] = raw.Value;
    }
  }

  const name = metadata["Institution Name"];
  const rawRssdId = metadata["ID_RSSD"];
  if (name === undefined || rawRssdId === undefined || lineRows.length === 0) {
    throw new Error(SHAPE_ERROR);
  }

  const institutionWarnings: string[] = [];
  const rssdId = optionalInteger(rawRssdId, "ID_RSSD", institutionWarnings);
  if (
    options.expectedRssdId !== undefined &&
    rssdId !== undefined &&
    rssdId !== options.expectedRssdId
  ) {
    throw new Error("FFIEC 002 CSV did not match the requested RSSD ID");
  }

  const institution: Ffiec002Institution = {
    name,
    ...(rssdId !== undefined ? { rssdId } : {}),
    ...optionalMetadataFields(metadata),
    raw: metadata,
    warnings: institutionWarnings,
  };

  const normalizedLimit = normalizeLimit(options.limit);
  const selectedRows =
    normalizedLimit === undefined ? lineRows : lineRows.slice(0, normalizedLimit);
  const lineItems = selectedRows.map((row) => parseLineItem(row, reportingDate, rssdId));
  return {
    reportingDate,
    institution,
    lineItems,
    warnings: [...institutionWarnings, ...lineItems.flatMap((lineItem) => lineItem.warnings)],
  };
}

/** Fetches one institution-quarter FFIEC 002 filing as a typed data release. */
export async function fetchFfiec002Report(
  params: Ffiec002ReportParams,
  options: SourceFetchOptions = {},
): Promise<Ffiec002Release | undefined> {
  const reportUrl = ffiec002ReportCsvUrl(params);
  if (normalizeLimit(options.limit) === 0) return undefined;

  const reportingDate = ffiec002ReportingDate(params.reportingDate);
  const report = parseFfiec002Report(await fetchText(reportUrl, options), {
    reportingDate,
    expectedRssdId: params.rssdId,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return {
    provider: FFIEC_002_PROVIDER_ID,
    dataset: String(params.rssdId),
    asOf: reportingDate,
    url: ffiec002InstitutionProfileUrl(params.rssdId),
    institution: report.institution,
    rows: report.lineItems,
    warnings: report.warnings,
  };
}

/** Binds one RSSD ID and reporting quarter to the generic structured-data lane. */
export function ffiec002DataSource(
  params: Ffiec002ReportParams,
  options: SourceFetchOptions = {},
): DataSource<Ffiec002LineItem> {
  const dataset = String(params.rssdId);
  const requestUrl = ffiec002ReportCsvUrl(params);
  const merged = (fetchOptions: SourceFetchOptions): SourceFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: FFIEC_002_PROVIDER_ID,
    dataset,
    requestUrls: (fetchOptions = {}) =>
      normalizeLimit(merged(fetchOptions).limit) === 0 ? [] : [requestUrl],
    fetchRelease: (fetchOptions = {}) => fetchFfiec002Report(params, merged(fetchOptions)),
  };
}

function parseLineItem(
  raw: Ffiec002CsvRow,
  reportingDate: string,
  rssdId: number | undefined,
): Ffiec002LineItem {
  if (TEXT_ITEM.test(raw.ItemName)) {
    return {
      reportingDate,
      ...(rssdId !== undefined ? { rssdId } : {}),
      mdrm: raw.ItemName,
      description: raw.Description,
      valueType: "text",
      rawValue: raw.Value,
      textValue: raw.Value,
      raw,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const numericValue = optionalNumber(raw.Value, raw.ItemName, warnings);
  return {
    reportingDate,
    ...(rssdId !== undefined ? { rssdId } : {}),
    mdrm: raw.ItemName,
    description: raw.Description,
    valueType: "number",
    rawValue: raw.Value,
    ...(numericValue !== undefined ? { numericValue } : {}),
    raw,
    warnings,
  };
}

function optionalMetadataFields(
  metadata: Readonly<Record<string, string>>,
): Omit<Ffiec002Institution, "name" | "rssdId" | "raw" | "warnings"> {
  return {
    ...(metadata["Street Address"] !== undefined
      ? { streetAddress: metadata["Street Address"] }
      : {}),
    ...(metadata["City"] !== undefined ? { city: metadata["City"] } : {}),
    ...(metadata["State"] !== undefined ? { state: metadata["State"] } : {}),
    ...(metadata["Zip Code"] !== undefined ? { zipCode: metadata["Zip Code"] } : {}),
    ...(metadata["Head Office Name"] !== undefined
      ? { headOfficeName: metadata["Head Office Name"] }
      : {}),
    ...(metadata["Head Office City"] !== undefined
      ? { headOfficeCity: metadata["Head Office City"] }
      : {}),
    ...(metadata["Head Office Country"] !== undefined
      ? { headOfficeCountry: metadata["Head Office Country"] }
      : {}),
  };
}

function optionalInteger(raw: string, field: string, warnings: string[]): number | undefined {
  const value = optionalNumber(raw, field, warnings);
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value)) {
    warnings.push(`${field} value ${JSON.stringify(raw)} is not a safe integer`);
    return undefined;
  }
  return value;
}

function optionalNumber(raw: string, field: string, warnings: string[]): number | undefined {
  const text = raw.trim();
  if (!text) {
    warnings.push(`${field} value ${JSON.stringify(raw)} is not a finite number`);
    return undefined;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    warnings.push(`${field} value ${JSON.stringify(raw)} is not a finite number`);
    return undefined;
  }
  return value;
}
