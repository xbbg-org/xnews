import { parseCsvRecords } from "../csv.js";
import { parsePublishedAt } from "../dates.js";
import { XnewsFetchError } from "../errors.js";
import { fetchRaw } from "../http.js";
import { normalizeLimit } from "../options.js";
import { decodeEntities, stripAsciiControlCharacters } from "../text.js";
import { readZipEntries, type ZipEntry } from "../zip.js";
import { NIC_BULK_PRODUCTS, NIC_DATA_DOWNLOAD_URL, nicBulkProductDefinition } from "./nic.urls.js";
import type { NicBulkProduct, NicBulkProductDefinition } from "./nic.urls.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";

export {
  NIC_BULK_PRODUCTS,
  NIC_DATA_DICTIONARY_URL,
  NIC_DATA_DOWNLOAD_URL,
  NIC_REFRESH_FAQ_URL,
  nicBulkDownloadUrl,
  nicBulkProductDefinition,
} from "./nic.urls.js";
export type { NicBulkProduct, NicBulkProductDefinition, NicBulkRecordKind } from "./nic.urls.js";

/**
 * Response ceiling for current NPW CSV ZIPs. The verified products run from
 * about 0.6 MiB to 14 MiB compressed; this leaves room for registry growth.
 */
export const NIC_BULK_MAX_BYTES = 64 * 1024 * 1024;

export type NicInstitutionProduct = Exclude<NicBulkProduct, "relationships" | "transformations">;

export interface NicPageProduct {
  readonly product: NicBulkProduct;
  readonly label: string;
  readonly downloadUrl: string;
  /** ISO date shown beside this product as its last update. */
  readonly updatedAt: string;
}

/** Authoritative product list and refresh stamps parsed from the NPW page. */
export interface NicBulkPage {
  readonly products: readonly NicPageProduct[];
}

/** One Attributes row from the active, closed, or branches snapshot. */
export interface NicInstitution {
  /** Federal Reserve entity identifier and FFIEC Call Report join key. */
  readonly rssdId?: number;
  readonly name?: string;
  readonly shortName?: string;
  readonly entityType?: string;
  readonly charterAuthorityCode?: number;
  readonly charterTypeCode?: number;
  readonly fdicCertificateId?: string;
  readonly occCharterId?: string;
  readonly headOfficeRssdId?: number;
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
  readonly postalCode?: string;
  readonly streetLine1?: string;
  readonly streetLine2?: string;
  /** Whether the entity's existence-termination date is the open-ended sentinel. */
  readonly isActive?: boolean;
  readonly establishedAt?: string;
  readonly terminatedAt?: string;
  readonly openedAt?: string;
  readonly warnings: readonly string[];
  readonly raw: Readonly<Record<string, string>>;
}

/** One historical ownership edge from the Relationships snapshot. */
export interface NicRelationship {
  readonly parentRssdId?: number;
  readonly offspringRssdId?: number;
  readonly percentHeld?: number;
  readonly percentOther?: number;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly establishedAt?: string;
  readonly warnings: readonly string[];
  readonly raw: Readonly<Record<string, string>>;
}

/** One merger, acquisition, or failure link from Transformations. */
export interface NicTransformation {
  readonly predecessorRssdId?: number;
  readonly successorRssdId?: number;
  readonly transformedAt?: string;
  readonly transformationCode?: number;
  readonly accountingMethod?: number;
  readonly warnings: readonly string[];
  readonly raw: Readonly<Record<string, string>>;
}

export type NicRecord = NicInstitution | NicRelationship | NicTransformation;

const PAGE_BUTTON_DATE =
  /<button\b[^>]*\bonclick\s*=\s*(["'])([^"']+)\1[^>]*>[\s\S]*?<span\b[^>]*class\s*=\s*(["'])[^"']*\blink-text-align-svg\b[^"']*\3[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/button>\s*<span\b[^>]*class\s*=\s*(["'])[^"']*\bfootnote\b[^"']*\5[^>]*>([\s\S]*?)<\/span>/gi;
const PAGE_FUNCTION = /function\s+([A-Za-z0-9_]+)\s*\(\s*\)\s*\{([^}]*)\}/gi;
const LOCATION_ASSIGNMENT =
  /window\.location\.href\s*=\s*(["'])(\/npw\/FinancialReport\/[A-Za-z0-9]+)\1\s*;?/i;
const US_DATE_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+00:00:00)?$/;
const OPEN_ENDED_DATE = /^12\/31\/9999(?:\s+00:00:00)?$/;
const entryDecoder = new TextDecoder("utf-8", { fatal: true });

/** Parses the NPW structure-download page. Pure and network-free. */
export function parseNicBulkPage(html: string): NicBulkPage {
  const actions = new Map<string, string>();
  for (const match of html.matchAll(PAGE_FUNCTION)) {
    const assignment = LOCATION_ASSIGNMENT.exec(match[2] ?? "");
    if (match[1] && assignment?.[2]) actions.set(match[1], decodeEntities(assignment[2]));
  }

  const buttons = new Map<string, { label: string; updatedAt: string }>();
  for (const match of html.matchAll(PAGE_BUTTON_DATE)) {
    const action = (match[2] ?? "").trim().replace(/\(\s*\)$/, "");
    const label = decodeEntities(match[4] ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const updatedAt = parsePageDate(decodeEntities(match[6] ?? ""));
    if (action && label && updatedAt) buttons.set(action, { label, updatedAt });
  }

  const products = NIC_BULK_PRODUCTS.map((definition) => {
    const expectedPath = new URL(definition.downloadUrl).pathname;
    const endpoint = actions.get(definition.pageAction);
    const button = buttons.get(definition.pageAction);
    const actualLabel = (button?.label ?? "")
      .toLowerCase()
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    const expectedLabel = definition.label
      .toLowerCase()
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    if (endpoint !== expectedPath || button === undefined || actualLabel !== expectedLabel) {
      throw new Error(`NIC data download page is missing ${definition.label}`);
    }
    return {
      product: definition.product,
      label: definition.label,
      downloadUrl: definition.downloadUrl,
      updatedAt: button.updatedAt,
    };
  });

  return { products };
}

function parsePageDate(value: string): string | undefined {
  const normalized = normalizedNicDate(value);
  const parsed = normalized === undefined ? null : parsePublishedAt(normalized);
  return parsed?.instant.slice(0, 10);
}

/** Fetches and validates the authoritative product list and refresh stamps. */
export async function fetchNicBulkPage(options: SourceFetchOptions = {}): Promise<NicBulkPage> {
  const result = await fetchRaw(NIC_DATA_DOWNLOAD_URL, options);
  try {
    return parseNicBulkPage(entryDecoder.decode(result.bytes));
  } catch {
    throw new XnewsFetchError("network", "NIC data download page has an unexpected structure", {
      url: NIC_DATA_DOWNLOAD_URL,
    });
  }
}

export interface NicBulkDownload {
  readonly product: NicBulkProduct;
  /** Filename from Content-Disposition, sanitized to a bare basename. */
  readonly filename: string;
  readonly contentType?: string;
  readonly bytes: Uint8Array;
}

/** Downloads one current CSV ZIP through its direct, keyless GET action. */
export async function downloadNicBulkData(
  product: NicBulkProduct,
  options: SourceFetchOptions = {},
): Promise<NicBulkDownload> {
  const definition = nicBulkProductDefinition(product);
  const result = await fetchRaw(definition.downloadUrl, {
    ...options,
    maxResponseBytes: options.maxResponseBytes ?? NIC_BULK_MAX_BYTES,
  });
  const contentType = (result.contentType ?? "").toLowerCase();
  const disposition = result.contentDisposition ?? "";
  const hasZipMagic =
    result.bytes[0] === 0x50 && result.bytes[1] === 0x4b && result.bytes[2] === 0x03;
  if (!contentType.includes("zip") || !hasZipMagic) {
    throw new XnewsFetchError("network", "NIC download did not return a ZIP archive", {
      url: definition.downloadUrl,
    });
  }

  return {
    product: definition.product,
    filename: filenameFromDisposition(disposition) ?? definition.archiveName,
    ...(result.contentType === undefined ? {} : { contentType: result.contentType }),
    bytes: result.bytes,
  };
}

/** Parses an Attributes CSV into institution records. */
export function parseNicInstitutions(
  body: string,
  product: NicInstitutionProduct = "attributes-active",
  limit?: number,
): NicInstitution[] {
  const definition = nicBulkProductDefinition(product);
  if (definition.recordKind !== "institution") {
    throw new RangeError(`NIC product ${product} does not contain institution records`);
  }
  const table = parseNicCsv(body, definition, INSTITUTION_COLUMNS, limit);
  return table.rows.map((raw) => institutionFromRaw(raw));
}

/** Parses a Relationships CSV into historical ownership edges. */
export function parseNicRelationships(body: string, limit?: number): NicRelationship[] {
  const definition = nicBulkProductDefinition("relationships");
  const table = parseNicCsv(body, definition, RELATIONSHIP_COLUMNS, limit);
  return table.rows.map((raw) => relationshipFromRaw(raw));
}

/** Parses a Transformations CSV into predecessor-successor links. */
export function parseNicTransformations(body: string, limit?: number): NicTransformation[] {
  const definition = nicBulkProductDefinition("transformations");
  const table = parseNicCsv(body, definition, TRANSFORMATION_COLUMNS, limit);
  return table.rows.map((raw) => transformationFromRaw(raw));
}

function isNicInstitutionProduct(product: NicBulkProduct): product is NicInstitutionProduct {
  return NIC_BULK_PRODUCTS.some(
    (definition) => definition.product === product && definition.recordKind === "institution",
  );
}

/** Unzips and parses the single CSV entry expected for a product. */
export async function parseNicBulkArchive(
  archive: Uint8Array,
  product: NicBulkProduct,
  limit?: number,
): Promise<readonly NicRecord[]> {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];
  const definition = nicBulkProductDefinition(product);
  let entries: readonly ZipEntry[];
  try {
    entries = await readZipEntries(archive, `NIC ${product} archive`);
  } catch {
    throw new Error(`NIC ${product} archive is malformed`);
  }
  if (
    entries.length !== 1 ||
    entries[0]?.name.toUpperCase() !== definition.entryName.toUpperCase()
  ) {
    throw new Error(`NIC ${product} archive does not contain its expected CSV entry`);
  }

  let body: string;
  try {
    body = entryDecoder.decode(entries[0].bytes);
  } catch {
    throw new Error(`NIC ${product} archive contains invalid UTF-8`);
  }
  if (isNicInstitutionProduct(product)) {
    return parseNicInstitutions(body, product, normalizedLimit);
  }
  if (definition.recordKind === "relationship") {
    return parseNicRelationships(body, normalizedLimit);
  }
  return parseNicTransformations(body, normalizedLimit);
}

const INSTITUTION_COLUMNS = [
  "#ID_RSSD",
  "NM_LGL",
  "NM_SHORT",
  "ENTITY_TYPE",
  "CHTR_AUTH_CD",
  "CHTR_TYPE_CD",
  "ID_FDIC_CERT",
  "ID_OCC",
  "ID_RSSD_HD_OFF",
  "CITY",
  "STATE_ABBR_NM",
  "CNTRY_NM",
  "ZIP_CD",
  "STREET_LINE1",
  "STREET_LINE2",
  "D_DT_EXIST_CMNC",
  "D_DT_EXIST_TERM",
  "D_DT_OPEN",
] as const;
const RELATIONSHIP_COLUMNS = [
  "#ID_RSSD_PARENT",
  "ID_RSSD_OFFSPRING",
  "PCT_EQUITY",
  "PCT_OTHER",
  "D_DT_START",
  "D_DT_END",
  "D_DT_RELN_EST",
] as const;
const TRANSFORMATION_COLUMNS = [
  "#ID_RSSD_PREDECESSOR",
  "ID_RSSD_SUCCESSOR",
  "D_DT_TRANS",
  "TRNSFM_CD",
  "ACCT_METHOD",
] as const;

interface NicCsvTable {
  readonly rows: readonly Readonly<Record<string, string>>[];
}

function parseNicCsv(
  body: string,
  definition: NicBulkProductDefinition,
  requiredColumns: readonly string[],
  limit?: number,
): NicCsvTable {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return { rows: [] };
  const records = parseCsvRecords(body);
  const header = records[0];
  if (header === undefined || records.length < 2) {
    throw new Error(`NIC ${definition.product} CSV has no data rows`);
  }
  if (
    new Set(header).size !== header.length ||
    requiredColumns.some((column) => !header.includes(column))
  ) {
    throw new Error(`NIC ${definition.product} CSV has an incompatible header`);
  }
  for (let index = 1; index < records.length; index += 1) {
    if (records[index]?.length !== header.length) {
      throw new Error(`NIC ${definition.product} CSV contains a truncated row`);
    }
  }

  const rowLimit = normalizedLimit ?? records.length - 1;
  const rows: Record<string, string>[] = [];
  for (let index = 1; index < records.length && rows.length < rowLimit; index += 1) {
    const cells = records[index]!;
    const raw: Record<string, string> = {};
    for (let column = 0; column < header.length; column += 1) {
      raw[header[column]!] = cells[column]!;
    }
    rows.push(raw);
  }
  return { rows };
}

function institutionFromRaw(raw: Readonly<Record<string, string>>): NicInstitution {
  const warnings: string[] = [];
  const terminatedAt = dateValue(raw, "D_DT_EXIST_TERM", warnings, true);
  const terminationText = raw["D_DT_EXIST_TERM"]?.trim() ?? "";
  const isActive = OPEN_ENDED_DATE.test(terminationText)
    ? true
    : terminationText === "" || terminatedAt === undefined
      ? undefined
      : false;
  return {
    ...numberField(raw, "#ID_RSSD", "rssdId", warnings),
    ...stringField(raw, "NM_LGL", "name"),
    ...stringField(raw, "NM_SHORT", "shortName"),
    ...stringField(raw, "ENTITY_TYPE", "entityType"),
    ...numberField(raw, "CHTR_AUTH_CD", "charterAuthorityCode", warnings),
    ...numberField(raw, "CHTR_TYPE_CD", "charterTypeCode", warnings),
    ...stringField(raw, "ID_FDIC_CERT", "fdicCertificateId", true),
    ...stringField(raw, "ID_OCC", "occCharterId", true),
    ...numberField(raw, "ID_RSSD_HD_OFF", "headOfficeRssdId", warnings, true),
    ...stringField(raw, "CITY", "city"),
    ...stringField(raw, "STATE_ABBR_NM", "state"),
    ...stringField(raw, "CNTRY_NM", "country"),
    ...stringField(raw, "ZIP_CD", "postalCode"),
    ...stringField(raw, "STREET_LINE1", "streetLine1", true),
    ...stringField(raw, "STREET_LINE2", "streetLine2", true),
    ...(isActive === undefined ? {} : { isActive }),
    ...dateProperty(raw, "D_DT_EXIST_CMNC", "establishedAt", warnings),
    ...(terminatedAt === undefined ? {} : { terminatedAt }),
    ...dateProperty(raw, "D_DT_OPEN", "openedAt", warnings),
    warnings,
    raw,
  };
}

function relationshipFromRaw(raw: Readonly<Record<string, string>>): NicRelationship {
  const warnings: string[] = [];
  return {
    ...numberField(raw, "#ID_RSSD_PARENT", "parentRssdId", warnings),
    ...numberField(raw, "ID_RSSD_OFFSPRING", "offspringRssdId", warnings),
    ...decimalField(raw, "PCT_EQUITY", "percentHeld", warnings),
    ...decimalField(raw, "PCT_OTHER", "percentOther", warnings),
    ...dateProperty(raw, "D_DT_START", "startAt", warnings),
    ...dateProperty(raw, "D_DT_END", "endAt", warnings, true),
    ...dateProperty(raw, "D_DT_RELN_EST", "establishedAt", warnings),
    warnings,
    raw,
  };
}

function transformationFromRaw(raw: Readonly<Record<string, string>>): NicTransformation {
  const warnings: string[] = [];
  return {
    ...numberField(raw, "#ID_RSSD_PREDECESSOR", "predecessorRssdId", warnings),
    ...numberField(raw, "ID_RSSD_SUCCESSOR", "successorRssdId", warnings),
    ...dateProperty(raw, "D_DT_TRANS", "transformedAt", warnings),
    ...numberField(raw, "TRNSFM_CD", "transformationCode", warnings),
    ...numberField(raw, "ACCT_METHOD", "accountingMethod", warnings),
    warnings,
    raw,
  };
}

function numberField<Key extends string>(
  raw: Readonly<Record<string, string>>,
  column: string,
  key: Key,
  warnings: string[],
  zeroIsMissing = false,
): Partial<Record<Key, number>> {
  const text = raw[column]?.trim() ?? "";
  if (text === "" || (zeroIsMissing && text === "0")) return {};
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    warnings.push(`${column} is not an integer: ${JSON.stringify(text)}`);
    return {};
  }
  const property: Partial<Record<Key, number>> = {};
  property[key] = value;
  return property;
}

function decimalField<Key extends string>(
  raw: Readonly<Record<string, string>>,
  column: string,
  key: Key,
  warnings: string[],
): Partial<Record<Key, number>> {
  const text = raw[column]?.trim() ?? "";
  if (text === "") return {};
  const value = Number(text);
  if (!Number.isFinite(value)) {
    warnings.push(`${column} is not numeric: ${JSON.stringify(text)}`);
    return {};
  }
  const property: Partial<Record<Key, number>> = {};
  property[key] = value;
  return property;
}

function stringField<Key extends string>(
  raw: Readonly<Record<string, string>>,
  column: string,
  key: Key,
  zeroIsMissing = false,
): Partial<Record<Key, string>> {
  const value = raw[column]?.trim() ?? "";
  if (value === "" || (zeroIsMissing && value === "0")) return {};
  const property: Partial<Record<Key, string>> = {};
  property[key] = value;
  return property;
}

function dateProperty<Key extends string>(
  raw: Readonly<Record<string, string>>,
  column: string,
  key: Key,
  warnings: string[],
  openEndedIsMissing = false,
): Partial<Record<Key, string>> {
  const value = dateValue(raw, column, warnings, openEndedIsMissing);
  if (value === undefined) return {};
  const property: Partial<Record<Key, string>> = {};
  property[key] = value;
  return property;
}

function dateValue(
  raw: Readonly<Record<string, string>>,
  column: string,
  warnings: string[],
  openEndedIsMissing = false,
): string | undefined {
  const text = raw[column]?.trim() ?? "";
  if (text === "" || (openEndedIsMissing && OPEN_ENDED_DATE.test(text))) return undefined;
  const normalized = normalizedNicDate(text);
  const parsed = normalized === undefined ? null : parsePublishedAt(normalized);
  if (parsed === null) {
    warnings.push(`${column} is not a date: ${JSON.stringify(text)}`);
    return undefined;
  }
  return parsed.instant;
}

function normalizedNicDate(value: string): string | undefined {
  const text = value.trim();
  const us = US_DATE_TIME.exec(text);
  if (us) {
    return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  }
  return text;
}

function filenameFromDisposition(disposition: string): string | undefined {
  const match = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposition);
  const raw = (match?.[1] ?? match?.[2] ?? "").trim();
  if (!raw) return undefined;
  const basename = raw.replaceAll("\\", "/").split("/").pop() ?? "";
  const cleaned = stripAsciiControlCharacters(basename)
    .replace(/[<>:"/\\|?*]/g, "")
    .trim();
  return cleaned === "" ? undefined : cleaned;
}

export interface NicDataOptions extends DataFetchOptions {
  readonly limit?: number;
}

/** Fetches one dated NPW structure snapshot as a typed data release. */
export async function fetchNicData(
  product: NicBulkProduct = "attributes-active",
  options: NicDataOptions = {},
): Promise<DataRelease<NicRecord> | undefined> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return undefined;
  validateIfNewerThan(options.ifNewerThan);
  const definition = nicBulkProductDefinition(product);
  const page = await fetchNicBulkPage(options);
  const pageProduct = page.products.find((candidate) => candidate.product === product);
  if (pageProduct === undefined) {
    throw new XnewsFetchError("network", "NIC page omitted a requested product", {
      url: NIC_DATA_DOWNLOAD_URL,
    });
  }
  if (options.ifNewerThan !== undefined && pageProduct.updatedAt <= options.ifNewerThan) {
    return undefined;
  }

  const download = await downloadNicBulkData(product, options);
  let rows: readonly NicRecord[];
  try {
    rows = await parseNicBulkArchive(download.bytes, product, limit);
  } catch {
    throw new XnewsFetchError("network", `NIC ${definition.label} archive is malformed`, {
      url: definition.downloadUrl,
    });
  }

  return {
    provider: "ffiec-nic",
    dataset: definition.product,
    asOf: pageProduct.updatedAt,
    updatedAt: pageProduct.updatedAt,
    url: NIC_DATA_DOWNLOAD_URL,
    rows,
  };
}

/** Binds one current NPW structure product to the shared data lane. */
export function nicDataSource(
  product: NicBulkProduct = "attributes-active",
  options: NicDataOptions = {},
): DataSource<NicRecord> {
  const definition = nicBulkProductDefinition(product);
  return {
    provider: "ffiec-nic",
    dataset: definition.product,
    requestUrls: () => [NIC_DATA_DOWNLOAD_URL, definition.downloadUrl],
    fetchRelease: (fetchOptions = {}) => fetchNicData(product, { ...options, ...fetchOptions }),
  };
}

function validateIfNewerThan(value: string | undefined): void {
  if (value === undefined) return;
  const parsed = parsePublishedAt(value);
  if (parsed?.format !== "date_only" || parsed.instant.slice(0, 10) !== value) {
    throw new XnewsFetchError("config", "ifNewerThan must be an ISO date in YYYY-MM-DD form", {
      url: NIC_DATA_DOWNLOAD_URL,
    });
  }
}
