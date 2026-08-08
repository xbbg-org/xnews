import { fetchRaw, fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import { readZipEntries } from "../zip.js";
import { CRA_FLAT_FILES_PAGE_URL, craFlatFileUrl } from "./cra.urls.js";
import type { CraFlatFileKind } from "./cra.urls.js";

export {
  CRA_DATA_PRODUCTS_URL,
  CRA_DISCLAIMER_URL,
  CRA_FLAT_FILE_KINDS,
  CRA_FLAT_FILE_YEARS,
  CRA_FLAT_FILES_PAGE_URL,
  craFlatFileDefinition,
  craFlatFileSpecsUrl,
  craFlatFileUrl,
} from "./cra.urls.js";
export type { CraFlatFileDefinition, CraFlatFileKind } from "./cra.urls.js";

/**
 * Response ceiling for one compressed CRA archive. The original 2024 files
 * are 34 KB, 5.4 MiB, and 21.8 MiB, but this higher file-specific ceiling
 * leaves room for revised disclosure archives without weakening other HTTP
 * consumers' shared 32 MiB ceiling.
 */
export const CRA_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;

export type CraAggregateLoanRecordType = "A1-1" | "A1-2" | "A2-1" | "A2-2";
export type CraAggregateLenderRecordType = "A1-1a" | "A1-2a" | "A2-1a" | "A2-2a";
export type CraDisclosureLoanRecordType = "D1-1" | "D1-2" | "D2-1" | "D2-2";

export interface CraRowBase {
  readonly kind: CraFlatFileKind;
  readonly recordType: string;
  readonly activityYear: number | undefined;
  /** The complete fixed-width record, excluding its line terminator. */
  readonly rawRecord: string;
  /** Per-field values that could not be converted without guessing. */
  readonly warnings: readonly string[];
}

export interface CraTransmittalRow extends CraRowBase {
  readonly kind: "transmittal";
  readonly recordType: "transmittal";
  readonly respondentId: string;
  readonly agencyCode: number | undefined;
  readonly respondentName: string;
  readonly respondentAddress: string;
  readonly respondentCity: string;
  readonly respondentState: string;
  readonly respondentZipCode: string;
  readonly taxId: string;
  readonly rssdId: string | undefined;
  readonly assetsThousands: number | undefined;
}

export interface CraAggregateLoanRow extends CraRowBase {
  readonly kind: "aggregate";
  readonly recordType: CraAggregateLoanRecordType;
  readonly loanType: number | undefined;
  readonly actionTakenType: number | undefined;
  readonly state: string | undefined;
  readonly county: string | undefined;
  readonly msaMd: string | undefined;
  readonly censusTract: string | undefined;
  readonly splitCountyIndicator: string | undefined;
  readonly populationClassification: string | undefined;
  readonly incomeGroup: number | undefined;
  readonly reportLevel: number | undefined;
  readonly loanCountUnder100k: number | undefined;
  readonly loanAmountUnder100kThousands: number | undefined;
  readonly loanCount100kTo250k: number | undefined;
  readonly loanAmount100kTo250kThousands: number | undefined;
  readonly loanCountOver250k: number | undefined;
  readonly loanAmountOver250kThousands: number | undefined;
  readonly grossRevenueUnder1mLoanCount: number | undefined;
  readonly grossRevenueUnder1mLoanAmountThousands: number | undefined;
}

export interface CraAggregateLenderRow extends CraRowBase {
  readonly kind: "aggregate";
  readonly recordType: CraAggregateLenderRecordType;
  readonly loanType: number | undefined;
  readonly actionTakenType: number | undefined;
  readonly state: string | undefined;
  readonly county: string | undefined;
  readonly msaMd: string | undefined;
  readonly respondentId: string | undefined;
  readonly agencyCode: number | undefined;
  readonly lenderCount: number | undefined;
  readonly reportLevel: number | undefined;
  readonly loanCount: number | undefined;
  readonly loanAmountThousands: number | undefined;
  readonly grossRevenueUnder1mLoanCount: number | undefined;
  readonly grossRevenueUnder1mLoanAmountThousands: number | undefined;
}

export interface CraDisclosureLoanRow extends CraRowBase {
  readonly kind: "disclosure";
  readonly recordType: CraDisclosureLoanRecordType;
  readonly respondentId: string;
  readonly agencyCode: number | undefined;
  readonly loanType: number | undefined;
  readonly actionTakenType: number | undefined;
  readonly state: string | undefined;
  readonly county: string | undefined;
  readonly msaMd: string | undefined;
  readonly assessmentAreaNumber: string | undefined;
  readonly partialCountyIndicator: string | undefined;
  readonly splitCountyIndicator: string | undefined;
  readonly populationClassification: string | undefined;
  readonly incomeGroup: number | undefined;
  readonly reportLevel: number | undefined;
  readonly loanCountUnder100k: number | undefined;
  readonly loanAmountUnder100kThousands: number | undefined;
  readonly loanCount100kTo250k: number | undefined;
  readonly loanAmount100kTo250kThousands: number | undefined;
  readonly loanCountOver250k: number | undefined;
  readonly loanAmountOver250kThousands: number | undefined;
  readonly grossRevenueUnder1mLoanCount: number | undefined;
  readonly grossRevenueUnder1mLoanAmountThousands: number | undefined;
  readonly affiliateLoanCount: number | undefined;
  readonly affiliateLoanAmountThousands: number | undefined;
}

export interface CraDisclosureAssessmentActivityRow extends CraRowBase {
  readonly kind: "disclosure";
  readonly recordType: "D3-0" | "D4-0";
  readonly respondentId: string;
  readonly agencyCode: number | undefined;
  readonly loanType: number | undefined;
  readonly state: string | undefined;
  readonly county: string | undefined;
  readonly msaMd: string | undefined;
  readonly assessmentAreaNumber: string | undefined;
  readonly partialCountyIndicator: string | undefined;
  readonly splitCountyIndicator: string | undefined;
  readonly reportLevel: number | undefined;
  readonly originatedLoanCount: number | undefined;
  readonly originatedLoanAmountThousands: number | undefined;
  readonly grossRevenueUnder1mLoanCount: number | undefined;
  readonly grossRevenueUnder1mLoanAmountThousands: number | undefined;
  readonly purchasedLoanCount: number | undefined;
  readonly purchasedLoanAmountThousands: number | undefined;
}

export interface CraDisclosureCommunityDevelopmentRow extends CraRowBase {
  readonly kind: "disclosure";
  readonly recordType: "D5-0";
  readonly respondentId: string;
  readonly agencyCode: number | undefined;
  readonly loanType: number | undefined;
  readonly loanCount: number | undefined;
  readonly loanAmountThousands: number | undefined;
  readonly affiliateLoanCount: number | undefined;
  readonly affiliateLoanAmountThousands: number | undefined;
  readonly actionType: string | undefined;
}

export interface CraDisclosureAssessmentAreaRow extends CraRowBase {
  readonly kind: "disclosure";
  readonly recordType: "D6-0";
  readonly respondentId: string;
  readonly agencyCode: number | undefined;
  readonly state: string | undefined;
  readonly county: string | undefined;
  readonly msaMd: string | undefined;
  readonly censusTract: string | undefined;
  readonly assessmentAreaNumber: string | undefined;
  readonly partialCountyIndicator: string | undefined;
  readonly splitCountyIndicator: string | undefined;
  readonly populationClassification: string | undefined;
  readonly incomeGroup: number | undefined;
  readonly loanIndicator: string | undefined;
}

export type CraRow =
  | CraTransmittalRow
  | CraAggregateLoanRow
  | CraAggregateLenderRow
  | CraDisclosureLoanRow
  | CraDisclosureAssessmentActivityRow
  | CraDisclosureCommunityDevelopmentRow
  | CraDisclosureAssessmentAreaRow;

export interface CraFlatFileCatalogEntry {
  readonly year: number;
  readonly kind: CraFlatFileKind;
  readonly url: string;
}

export interface CraFlatFile {
  readonly year: number;
  readonly kind: CraFlatFileKind;
  readonly files: readonly string[];
  readonly rows: readonly CraRow[];
  readonly warnings: readonly string[];
}

export interface CraFetchedFlatFile extends CraFlatFile {
  readonly url: string;
  readonly archiveSizeBytes: number;
  readonly contentType?: string;
}

export interface CraArchiveParseOptions {
  readonly limit?: number;
}

export interface CraDataSourceOptions extends DataFetchOptions {
  /** Defaults to the latest year linked by the live FFIEC flat-files page. */
  readonly year?: number | "latest";
}

const ARCHIVE_LINK = /href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
const ORIGINAL_ARCHIVE_PATH = /\/(\d{2})exp_(trans|aggr|discl)\.zip$/i;
const SUFFIX_KIND: Readonly<Record<string, CraFlatFileKind>> = {
  trans: "transmittal",
  aggr: "aggregate",
  discl: "disclosure",
};
const CRA_AGGREGATE_LOAN_RECORD_TYPES = ["A1-1", "A1-2", "A2-1", "A2-2"] as const;
const CRA_AGGREGATE_LENDER_RECORD_TYPES = ["A1-1a", "A1-2a", "A2-1a", "A2-2a"] as const;
const CRA_DISCLOSURE_LOAN_RECORD_TYPES = ["D1-1", "D1-2", "D2-1", "D2-2"] as const;
const EXPECTED_TYPES: Readonly<Record<Exclude<CraFlatFileKind, "transmittal">, readonly string[]>> =
  {
    aggregate: [...CRA_AGGREGATE_LOAN_RECORD_TYPES, ...CRA_AGGREGATE_LENDER_RECORD_TYPES],
    disclosure: [...CRA_DISCLOSURE_LOAN_RECORD_TYPES, "D3-0", "D4-0", "D5-0", "D6-0"],
  };

function isCraAggregateLoanRecordType(value: string): value is CraAggregateLoanRecordType {
  return (CRA_AGGREGATE_LOAN_RECORD_TYPES as readonly string[]).includes(value);
}

function isCraAggregateLenderRecordType(value: string): value is CraAggregateLenderRecordType {
  return (CRA_AGGREGATE_LENDER_RECORD_TYPES as readonly string[]).includes(value);
}

function isCraDisclosureLoanRecordType(value: string): value is CraDisclosureLoanRecordType {
  return (CRA_DISCLOSURE_LOAN_RECORD_TYPES as readonly string[]).includes(value);
}
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });

/** Parses the original annual ZIP links from the FFIEC flat-files catalog page. */
export function parseCraFlatFileCatalog(html: string): readonly CraFlatFileCatalogEntry[] {
  if (!/Aggregate\s*&(?:amp;)?\s*Disclosure\s+Flat\s+Files/i.test(html)) {
    throw new Error("unexpected CRA flat-files catalog response shape");
  }

  const entries = new Map<string, CraFlatFileCatalogEntry>();
  for (const match of html.matchAll(ARCHIVE_LINK)) {
    const href = (match[1] ?? match[2] ?? "").replaceAll("&amp;", "&");
    let url: URL;
    try {
      url = new URL(href, CRA_FLAT_FILES_PAGE_URL);
    } catch {
      continue;
    }
    if (url.hostname !== "www.ffiec.gov") continue;
    const path = ORIGINAL_ARCHIVE_PATH.exec(url.pathname);
    if (path === null) continue;
    const suffix = (path[2] ?? "").toLowerCase();
    const kind = SUFFIX_KIND[suffix];
    if (kind === undefined) continue;
    const shortYear = Number(path[1]);
    const year = shortYear >= 96 ? 1900 + shortYear : 2000 + shortYear;
    entries.set(`${year}:${kind}`, { year, kind, url: url.href });
  }

  if (entries.size === 0) {
    throw new Error("unexpected CRA flat-files catalog response shape");
  }
  return [...entries.values()].toSorted(
    (left, right) => right.year - left.year || left.kind.localeCompare(right.kind),
  );
}

/** Lists the activity years represented by original flat-file links. */
export function parseCraAvailableYears(html: string): readonly number[] {
  return [...new Set(parseCraFlatFileCatalog(html).map((entry) => entry.year))].toSorted(
    (left, right) => right - left,
  );
}

/** Fetches the small catalog page, not any bulk archive. */
export async function fetchCraAvailableYears(
  options: SourceFetchOptions = {},
): Promise<readonly number[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const years = parseCraAvailableYears(await fetchText(CRA_FLAT_FILES_PAGE_URL, options));
  return limit === undefined ? years : years.slice(0, limit);
}

/**
 * Parses one CRA fixed-width record. Current offsets follow the 2024 layouts:
 * https://www.ffiec.gov/sites/default/files/data/cra/flat-files/24FlatTransSpecs.pdf,
 * https://www.ffiec.gov/sites/default/files/data/cra/flat-files/24FlatAggSpecs.pdf, and
 * https://www.ffiec.gov/sites/default/files/data/cra/flat-files/24FlatDiscSpecs.pdf.
 * The narrower 1996-2003 fields follow each year's matching specs at the same path.
 */
export function parseCraRecord(record: string, kind: CraFlatFileKind): CraRow {
  const shape = validateRecordShape(record, kind);
  const recordType = shape.recordType;
  if (kind === "transmittal") return parseTransmittal(record);
  if (isCraAggregateLoanRecordType(recordType)) {
    return shape.legacy
      ? parseLegacyAggregateLoan(record, recordType, shape)
      : parseAggregateLoan(record, recordType);
  }
  if (isCraAggregateLenderRecordType(recordType)) {
    return shape.legacy
      ? parseLegacyAggregateLender(record, recordType, shape)
      : parseAggregateLender(record, recordType);
  }
  if (isCraDisclosureLoanRecordType(recordType)) {
    return shape.legacy
      ? parseLegacyDisclosureLoan(record, recordType, shape)
      : parseDisclosureLoan(record, recordType);
  }
  if (recordType === "D3-0" || recordType === "D4-0") {
    return shape.legacy
      ? parseLegacyDisclosureAssessmentActivity(record, recordType, shape)
      : parseDisclosureAssessmentActivity(record, recordType);
  }
  if (recordType === "D5-0") {
    return shape.legacy
      ? parseLegacyDisclosureCommunityDevelopment(record, shape)
      : parseDisclosureCommunityDevelopment(record);
  }
  return shape.legacy
    ? parseLegacyDisclosureAssessmentArea(record, shape)
    : parseDisclosureAssessmentArea(record);
}

/** Unzips and parses every `.dat` member in one annual CRA archive. */
export async function parseCraFlatFileArchive(
  archive: Uint8Array,
  year: number,
  kind: CraFlatFileKind,
  options: CraArchiveParseOptions = {},
): Promise<CraFlatFile> {
  validateParsedYear(year);
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return { year, kind, files: [], rows: [], warnings: [] };

  const entries = await readZipEntries(archive, `CRA ${kind} archive`);
  const files: string[] = [];
  const rows: CraRow[] = [];
  const warnings: string[] = [];
  const recordTypes = new Set<string>();
  let recordCount = 0;

  for (const entry of entries) {
    if (!/\.dat$/i.test(entry.name)) continue;
    files.push(entry.name);
    let text: string;
    try {
      text = fatalDecoder.decode(entry.bytes);
    } catch {
      throw new Error(`CRA ${kind} archive contains a non-UTF-8 data file`);
    }

    for (const record of fixedWidthLines(text)) {
      if (record === "") {
        throw new Error(`CRA ${kind} archive contains a blank record`);
      }
      recordCount += 1;
      const shape = validateRecordShape(record, kind);
      recordTypes.add(shape.recordType);
      if (shape.activityYear !== undefined && shape.activityYear !== year) {
        throw new Error(`CRA ${kind} archive contains a record for a different activity year`);
      }
      if (limit !== undefined && rows.length >= limit) continue;
      const row = parseCraRecord(record, kind);
      rows.push(row);
      warnings.push(...row.warnings);
    }
  }

  if (files.length === 0 || recordCount === 0) {
    throw new Error(`CRA ${kind} archive contained no fixed-width data records`);
  }
  if (kind !== "transmittal") {
    const expected =
      kind === "aggregate" && year === 1996
        ? CRA_AGGREGATE_LOAN_RECORD_TYPES
        : EXPECTED_TYPES[kind];
    if (expected.some((recordType) => !recordTypes.has(recordType))) {
      throw new Error(`CRA ${kind} archive is missing one or more documented record types`);
    }
  }
  return { year, kind, files, rows, warnings };
}

/** Downloads and parses one original annual CRA flat-file archive. */
export async function fetchCraFlatFile(
  year: number,
  kind: CraFlatFileKind,
  options: SourceFetchOptions = {},
): Promise<CraFetchedFlatFile> {
  const url = craFlatFileUrl(year, kind);
  const limit = normalizeLimit(options.limit);
  if (limit === 0) {
    return {
      year,
      kind,
      url,
      archiveSizeBytes: 0,
      files: [],
      rows: [],
      warnings: [],
    };
  }
  return fetchCraFlatFileAtUrl(year, kind, url, options);
}

/** Fetches one annual CRA release, resolving `year: "latest"` through the live catalog. */
export async function fetchCraRelease(
  kind: CraFlatFileKind,
  options: CraDataSourceOptions = {},
): Promise<DataRelease<CraRow> | undefined> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return undefined;

  let year: number;
  let archiveUrl: string;
  if (options.year !== undefined && options.year !== "latest") {
    year = options.year;
    archiveUrl = craFlatFileUrl(year, kind);
  } else {
    const catalog = parseCraFlatFileCatalog(await fetchText(CRA_FLAT_FILES_PAGE_URL, options));
    const latest = catalog.find((entry) => entry.kind === kind);
    if (latest === undefined) {
      throw new Error(`CRA flat-files catalog contained no ${kind} archive`);
    }
    year = latest.year;
    archiveUrl = latest.url;
  }

  const asOf = `${year}-12-31`;
  if (options.ifNewerThan !== undefined && options.ifNewerThan >= asOf) return undefined;
  const flatFile = await fetchCraFlatFileAtUrl(year, kind, archiveUrl, options);
  return {
    provider: "ffiec-cra",
    dataset: `${kind}-flat-file`,
    asOf,
    url: CRA_FLAT_FILES_PAGE_URL,
    rows: flatFile.rows,
  };
}

/** Binds one annual CRA flat-file kind to the generic data lane. */
export function craDataSource(
  kind: CraFlatFileKind,
  options: CraDataSourceOptions = {},
): DataSource<CraRow> {
  return {
    provider: "ffiec-cra",
    dataset: `${kind}-flat-file`,
    requestUrls: (fetchOptions = {}) => {
      const merged = { ...options, ...fetchOptions };
      if (normalizeLimit(merged.limit) === 0) return [];
      if (merged.year === undefined || merged.year === "latest") return [CRA_FLAT_FILES_PAGE_URL];
      const asOf = `${merged.year}-12-31`;
      if (merged.ifNewerThan !== undefined && merged.ifNewerThan >= asOf) return [];
      return [craFlatFileUrl(merged.year, kind)];
    },
    fetchRelease: (fetchOptions = {}) => fetchCraRelease(kind, { ...options, ...fetchOptions }),
  };
}

async function fetchCraFlatFileAtUrl(
  year: number,
  kind: CraFlatFileKind,
  url: string,
  options: SourceFetchOptions,
): Promise<CraFetchedFlatFile> {
  const result = await fetchRaw(url, {
    ...options,
    maxResponseBytes: options.maxResponseBytes ?? CRA_ARCHIVE_MAX_BYTES,
  });
  if ((result.contentType ?? "").toLowerCase().includes("text/html")) {
    throw new Error(`CRA ${kind} download returned HTML instead of a ZIP archive`);
  }
  const flatFile = await parseCraFlatFileArchive(
    result.bytes,
    year,
    kind,
    options.limit === undefined ? {} : { limit: options.limit },
  );
  return {
    ...flatFile,
    url,
    archiveSizeBytes: result.bytes.byteLength,
    ...(result.contentType === undefined ? {} : { contentType: result.contentType }),
  };
}

interface CraRecordShape {
  readonly recordType: string;
  readonly typeWidth: number;
  readonly activityYear: number | undefined;
  readonly legacy: boolean;
  readonly msaWidth: 4 | 5;
}

function validateRecordShape(record: string, kind: CraFlatFileKind): CraRecordShape {
  if (kind === "transmittal") {
    const rawYear = record.slice(11, 15);
    const activityYear = /^\d{4}$/.test(rawYear) ? Number(rawYear) : undefined;
    const legacy = activityYear === 1996 || (activityYear === undefined && record.length === 132);
    const activeLength = legacy ? 132 : 152;
    if (record.length < activeLength) {
      throw new Error("CRA transmittal flat file contains a truncated record");
    }
    if (record.length > activeLength) {
      throw new Error("CRA transmittal flat file has an incompatible record length");
    }
    return { recordType: "transmittal", typeWidth: 0, activityYear, legacy, msaWidth: 5 };
  }

  let recordType: string;
  let typeWidth: number;
  if (kind === "aggregate") {
    // The state-level tables carry a five-character id ending in `a` and a
    // shorter record; the county-level tables pad a four-character id with a
    // space. Only an id that matched neither is unrecognized.
    const possibleLenderType = record.slice(0, 5);
    if (isCraAggregateLenderRecordType(possibleLenderType)) {
      recordType = possibleLenderType;
      typeWidth = 5;
    } else {
      recordType = record.slice(0, 4);
      typeWidth = record[4] === " " ? 5 : 4;
      if (!isCraAggregateLoanRecordType(recordType)) {
        throw new Error("CRA aggregate flat file contains an unrecognized record-type code");
      }
    }
  } else {
    recordType = record.slice(0, 4);
    typeWidth = record[4] === " " ? 5 : 4;
    if (
      !isCraDisclosureLoanRecordType(recordType) &&
      recordType !== "D3-0" &&
      recordType !== "D4-0" &&
      recordType !== "D5-0" &&
      recordType !== "D6-0"
    ) {
      throw new Error("CRA disclosure flat file contains an unrecognized record-type code");
    }
  }

  const yearStart = kind === "aggregate" ? typeWidth : typeWidth + 11;
  const rawYear = record.slice(yearStart, yearStart + 4);
  const activityYear = /^\d{4}$/.test(rawYear) ? Number(rawYear) : undefined;
  const legacy =
    activityYear !== undefined
      ? activityYear < 2004
      : kind === "aggregate"
        ? recordType.endsWith("a")
          ? record.length !== 80
          : record.length !== 116
        : record.length !== 145 &&
          record.length !== 99 &&
          record.length !== 62 &&
          record.length !== 48;
  const msaWidth: 4 | 5 =
    activityYear !== undefined && activityYear < 2000 ? 4 : typeWidth === 4 ? 4 : 5;

  let activeLength: number;
  if (kind === "aggregate") {
    if (recordType.endsWith("a")) {
      const headerLength = typeWidth + 4 + 1 + 1 + 2 + 3 + msaWidth + 10 + 1 + 5 + 3;
      activeLength = headerLength + (legacy ? 28 : 40);
    } else {
      const headerLength = typeWidth + 4 + 1 + 1 + 2 + 3 + msaWidth + 7 + 1 + 1 + 3 + 3;
      activeLength = headerLength + (legacy ? 56 : 80);
    }
  } else if (isCraDisclosureLoanRecordType(recordType)) {
    const headerLength = typeWidth + 10 + 1 + 4 + 1 + 1 + 2 + 3 + msaWidth + 4 + 1 + 1 + 1 + 3 + 3;
    activeLength = headerLength + (legacy ? 70 : 100);
  } else if (recordType === "D3-0" || recordType === "D4-0") {
    const headerLength = typeWidth + 10 + 1 + 4 + 1 + 2 + 3 + msaWidth + 4 + 1 + 1 + 2;
    activeLength = headerLength + (legacy ? 28 : 60);
  } else if (recordType === "D5-0") {
    const headerLength = typeWidth + 10 + 1 + 4 + 1;
    activeLength = headerLength + (legacy ? 28 : 41);
  } else {
    activeLength = typeWidth + 10 + 1 + 4 + 2 + 3 + msaWidth + 7 + 4 + 1 + 1 + 1 + 3 + 1;
  }

  if (record.length < activeLength) {
    throw new Error(`CRA ${kind} flat file contains a truncated record`);
  }
  if (record.length > 145 || record.slice(activeLength).trim() !== "") {
    throw new Error(`CRA ${kind} flat file has an incompatible record length`);
  }
  return { recordType, typeWidth, activityYear, legacy, msaWidth };
}

function parseTransmittal(record: string): CraTransmittalRow {
  const warnings: string[] = [];
  return {
    kind: "transmittal",
    recordType: "transmittal",
    respondentId: requiredText(record, 0, 10, "respondent ID"),
    agencyCode: integerField(record, 10, 11, "agency code", "transmittal", warnings),
    activityYear: integerField(record, 11, 15, "activity year", "transmittal", warnings),
    respondentName: requiredText(record, 15, 45, "respondent name"),
    respondentAddress: requiredText(record, 45, 85, "respondent address"),
    respondentCity: requiredText(record, 85, 110, "respondent city"),
    respondentState: requiredText(record, 110, 112, "respondent state"),
    respondentZipCode: requiredText(record, 112, 122, "respondent ZIP code"),
    taxId: requiredText(record, 122, 132, "tax ID"),
    rssdId: textField(record, 132, 142),
    assetsThousands: integerField(record, 142, 152, "assets", "transmittal", warnings),
    rawRecord: record,
    warnings,
  };
}
function parseLegacyAggregateLoan(
  record: string,
  recordType: CraAggregateLoanRecordType,
  shape: CraRecordShape,
): CraAggregateLoanRow {
  const warnings: string[] = [];
  const yearStart = shape.typeWidth;
  const loanTypeStart = yearStart + 4;
  const actionStart = loanTypeStart + 1;
  const stateStart = actionStart + 1;
  const countyStart = stateStart + 2;
  const msaStart = countyStart + 3;
  const tractStart = msaStart + shape.msaWidth;
  const splitStart = tractStart + 7;
  const populationStart = splitStart + 1;
  const incomeStart = populationStart + 1;
  const reportStart = incomeStart + 3;
  const metricsStart = reportStart + 3;
  return {
    kind: "aggregate",
    recordType,
    activityYear: integerField(
      record,
      yearStart,
      loanTypeStart,
      "activity year",
      recordType,
      warnings,
    ),
    loanType: integerField(record, loanTypeStart, actionStart, "loan type", recordType, warnings),
    actionTakenType: integerField(
      record,
      actionStart,
      stateStart,
      "action taken type",
      recordType,
      warnings,
    ),
    state: textField(record, stateStart, countyStart),
    county: textField(record, countyStart, msaStart),
    msaMd: textField(record, msaStart, tractStart),
    censusTract: textField(record, tractStart, splitStart),
    splitCountyIndicator: textField(record, splitStart, populationStart),
    populationClassification: textField(record, populationStart, incomeStart),
    incomeGroup: integerField(
      record,
      incomeStart,
      reportStart,
      "income group",
      recordType,
      warnings,
    ),
    reportLevel: integerField(
      record,
      reportStart,
      metricsStart,
      "report level",
      recordType,
      warnings,
    ),
    loanCountUnder100k: integerField(
      record,
      metricsStart,
      metricsStart + 6,
      "under-$100,000 loan count",
      recordType,
      warnings,
    ),
    loanAmountUnder100kThousands: integerField(
      record,
      metricsStart + 6,
      metricsStart + 14,
      "under-$100,000 loan amount",
      recordType,
      warnings,
    ),
    loanCount100kTo250k: integerField(
      record,
      metricsStart + 14,
      metricsStart + 20,
      "$100,000-$250,000 loan count",
      recordType,
      warnings,
    ),
    loanAmount100kTo250kThousands: integerField(
      record,
      metricsStart + 20,
      metricsStart + 28,
      "$100,000-$250,000 loan amount",
      recordType,
      warnings,
    ),
    loanCountOver250k: integerField(
      record,
      metricsStart + 28,
      metricsStart + 34,
      "over-$250,000 loan count",
      recordType,
      warnings,
    ),
    loanAmountOver250kThousands: integerField(
      record,
      metricsStart + 34,
      metricsStart + 42,
      "over-$250,000 loan amount",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanCount: integerField(
      record,
      metricsStart + 42,
      metricsStart + 48,
      "under-$1 million revenue loan count",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanAmountThousands: integerField(
      record,
      metricsStart + 48,
      metricsStart + 56,
      "under-$1 million revenue loan amount",
      recordType,
      warnings,
    ),
    rawRecord: record,
    warnings,
  };
}

function parseLegacyAggregateLender(
  record: string,
  recordType: CraAggregateLenderRecordType,
  shape: CraRecordShape,
): CraAggregateLenderRow {
  const warnings: string[] = [];
  const yearStart = shape.typeWidth;
  const loanTypeStart = yearStart + 4;
  const actionStart = loanTypeStart + 1;
  const stateStart = actionStart + 1;
  const countyStart = stateStart + 2;
  const msaStart = countyStart + 3;
  const respondentStart = msaStart + shape.msaWidth;
  const agencyStart = respondentStart + 10;
  const lendersStart = agencyStart + 1;
  const reportStart = lendersStart + 5;
  const metricsStart = reportStart + 3;
  return {
    kind: "aggregate",
    recordType,
    activityYear: integerField(
      record,
      yearStart,
      loanTypeStart,
      "activity year",
      recordType,
      warnings,
    ),
    loanType: integerField(record, loanTypeStart, actionStart, "loan type", recordType, warnings),
    actionTakenType: integerField(
      record,
      actionStart,
      stateStart,
      "action taken type",
      recordType,
      warnings,
    ),
    state: textField(record, stateStart, countyStart),
    county: textField(record, countyStart, msaStart),
    msaMd: textField(record, msaStart, respondentStart),
    respondentId: textField(record, respondentStart, agencyStart),
    agencyCode: integerField(
      record,
      agencyStart,
      lendersStart,
      "agency code",
      recordType,
      warnings,
    ),
    lenderCount: integerField(
      record,
      lendersStart,
      reportStart,
      "lender count",
      recordType,
      warnings,
    ),
    reportLevel: integerField(
      record,
      reportStart,
      metricsStart,
      "report level",
      recordType,
      warnings,
    ),
    loanCount: integerField(
      record,
      metricsStart,
      metricsStart + 6,
      "loan count",
      recordType,
      warnings,
    ),
    loanAmountThousands: integerField(
      record,
      metricsStart + 6,
      metricsStart + 14,
      "loan amount",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanCount: integerField(
      record,
      metricsStart + 14,
      metricsStart + 20,
      "under-$1 million revenue loan count",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanAmountThousands: integerField(
      record,
      metricsStart + 20,
      metricsStart + 28,
      "under-$1 million revenue loan amount",
      recordType,
      warnings,
    ),
    rawRecord: record,
    warnings,
  };
}

function parseLegacyDisclosureLoan(
  record: string,
  recordType: CraDisclosureLoanRecordType,
  shape: CraRecordShape,
): CraDisclosureLoanRow {
  const warnings: string[] = [];
  const respondentStart = shape.typeWidth;
  const agencyStart = respondentStart + 10;
  const yearStart = agencyStart + 1;
  const loanTypeStart = yearStart + 4;
  const actionStart = loanTypeStart + 1;
  const stateStart = actionStart + 1;
  const countyStart = stateStart + 2;
  const msaStart = countyStart + 3;
  const assessmentStart = msaStart + shape.msaWidth;
  const partialStart = assessmentStart + 4;
  const splitStart = partialStart + 1;
  const populationStart = splitStart + 1;
  const incomeStart = populationStart + 1;
  const reportStart = incomeStart + 3;
  const metricsStart = reportStart + 3;
  return {
    kind: "disclosure",
    recordType,
    respondentId: requiredText(record, respondentStart, agencyStart, "respondent ID"),
    agencyCode: integerField(record, agencyStart, yearStart, "agency code", recordType, warnings),
    activityYear: integerField(
      record,
      yearStart,
      loanTypeStart,
      "activity year",
      recordType,
      warnings,
    ),
    loanType: integerField(record, loanTypeStart, actionStart, "loan type", recordType, warnings),
    actionTakenType: integerField(
      record,
      actionStart,
      stateStart,
      "action taken type",
      recordType,
      warnings,
    ),
    state: textField(record, stateStart, countyStart),
    county: textField(record, countyStart, msaStart),
    msaMd: textField(record, msaStart, assessmentStart),
    assessmentAreaNumber: textField(record, assessmentStart, partialStart),
    partialCountyIndicator: textField(record, partialStart, splitStart),
    splitCountyIndicator: textField(record, splitStart, populationStart),
    populationClassification: textField(record, populationStart, incomeStart),
    incomeGroup: integerField(
      record,
      incomeStart,
      reportStart,
      "income group",
      recordType,
      warnings,
    ),
    reportLevel: integerField(
      record,
      reportStart,
      metricsStart,
      "report level",
      recordType,
      warnings,
    ),
    loanCountUnder100k: integerField(
      record,
      metricsStart,
      metricsStart + 6,
      "under-$100,000 loan count",
      recordType,
      warnings,
    ),
    loanAmountUnder100kThousands: integerField(
      record,
      metricsStart + 6,
      metricsStart + 14,
      "under-$100,000 loan amount",
      recordType,
      warnings,
    ),
    loanCount100kTo250k: integerField(
      record,
      metricsStart + 14,
      metricsStart + 20,
      "$100,000-$250,000 loan count",
      recordType,
      warnings,
    ),
    loanAmount100kTo250kThousands: integerField(
      record,
      metricsStart + 20,
      metricsStart + 28,
      "$100,000-$250,000 loan amount",
      recordType,
      warnings,
    ),
    loanCountOver250k: integerField(
      record,
      metricsStart + 28,
      metricsStart + 34,
      "over-$250,000 loan count",
      recordType,
      warnings,
    ),
    loanAmountOver250kThousands: integerField(
      record,
      metricsStart + 34,
      metricsStart + 42,
      "over-$250,000 loan amount",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanCount: integerField(
      record,
      metricsStart + 42,
      metricsStart + 48,
      "under-$1 million revenue loan count",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanAmountThousands: integerField(
      record,
      metricsStart + 48,
      metricsStart + 56,
      "under-$1 million revenue loan amount",
      recordType,
      warnings,
    ),
    affiliateLoanCount: integerField(
      record,
      metricsStart + 56,
      metricsStart + 62,
      "affiliate loan count",
      recordType,
      warnings,
    ),
    affiliateLoanAmountThousands: integerField(
      record,
      metricsStart + 62,
      metricsStart + 70,
      "affiliate loan amount",
      recordType,
      warnings,
    ),
    rawRecord: record,
    warnings,
  };
}

function parseLegacyDisclosureAssessmentActivity(
  record: string,
  recordType: "D3-0" | "D4-0",
  shape: CraRecordShape,
): CraDisclosureAssessmentActivityRow {
  const warnings: string[] = [];
  const respondentStart = shape.typeWidth;
  const agencyStart = respondentStart + 10;
  const yearStart = agencyStart + 1;
  const loanTypeStart = yearStart + 4;
  const stateStart = loanTypeStart + 1;
  const countyStart = stateStart + 2;
  const msaStart = countyStart + 3;
  const assessmentStart = msaStart + shape.msaWidth;
  const partialStart = assessmentStart + 4;
  const splitStart = partialStart + 1;
  const reportStart = splitStart + 1;
  const metricsStart = reportStart + 2;
  return {
    kind: "disclosure",
    recordType,
    respondentId: requiredText(record, respondentStart, agencyStart, "respondent ID"),
    agencyCode: integerField(record, agencyStart, yearStart, "agency code", recordType, warnings),
    activityYear: integerField(
      record,
      yearStart,
      loanTypeStart,
      "activity year",
      recordType,
      warnings,
    ),
    loanType: integerField(record, loanTypeStart, stateStart, "loan type", recordType, warnings),
    state: textField(record, stateStart, countyStart),
    county: textField(record, countyStart, msaStart),
    msaMd: textField(record, msaStart, assessmentStart),
    assessmentAreaNumber: textField(record, assessmentStart, partialStart),
    partialCountyIndicator: textField(record, partialStart, splitStart),
    splitCountyIndicator: textField(record, splitStart, reportStart),
    reportLevel: integerField(
      record,
      reportStart,
      metricsStart,
      "report level",
      recordType,
      warnings,
    ),
    originatedLoanCount: integerField(
      record,
      metricsStart,
      metricsStart + 6,
      "originated loan count",
      recordType,
      warnings,
    ),
    originatedLoanAmountThousands: integerField(
      record,
      metricsStart + 6,
      metricsStart + 14,
      "originated loan amount",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanCount: undefined,
    grossRevenueUnder1mLoanAmountThousands: undefined,
    purchasedLoanCount: integerField(
      record,
      metricsStart + 14,
      metricsStart + 20,
      "purchased loan count",
      recordType,
      warnings,
    ),
    purchasedLoanAmountThousands: integerField(
      record,
      metricsStart + 20,
      metricsStart + 28,
      "purchased loan amount",
      recordType,
      warnings,
    ),
    rawRecord: record,
    warnings,
  };
}

function parseLegacyDisclosureCommunityDevelopment(
  record: string,
  shape: CraRecordShape,
): CraDisclosureCommunityDevelopmentRow {
  const recordType = "D5-0";
  const warnings: string[] = [];
  const respondentStart = shape.typeWidth;
  const agencyStart = respondentStart + 10;
  const yearStart = agencyStart + 1;
  const loanTypeStart = yearStart + 4;
  const metricsStart = loanTypeStart + 1;
  return {
    kind: "disclosure",
    recordType,
    respondentId: requiredText(record, respondentStart, agencyStart, "respondent ID"),
    agencyCode: integerField(record, agencyStart, yearStart, "agency code", recordType, warnings),
    activityYear: integerField(
      record,
      yearStart,
      loanTypeStart,
      "activity year",
      recordType,
      warnings,
    ),
    loanType: integerField(record, loanTypeStart, metricsStart, "loan type", recordType, warnings),
    loanCount: integerField(
      record,
      metricsStart,
      metricsStart + 6,
      "loan count",
      recordType,
      warnings,
    ),
    loanAmountThousands: integerField(
      record,
      metricsStart + 6,
      metricsStart + 14,
      "loan amount",
      recordType,
      warnings,
    ),
    affiliateLoanCount: integerField(
      record,
      metricsStart + 14,
      metricsStart + 20,
      "affiliate loan count",
      recordType,
      warnings,
    ),
    affiliateLoanAmountThousands: integerField(
      record,
      metricsStart + 20,
      metricsStart + 28,
      "affiliate loan amount",
      recordType,
      warnings,
    ),
    actionType: undefined,
    rawRecord: record,
    warnings,
  };
}

function parseLegacyDisclosureAssessmentArea(
  record: string,
  shape: CraRecordShape,
): CraDisclosureAssessmentAreaRow {
  const recordType = "D6-0";
  const warnings: string[] = [];
  const respondentStart = shape.typeWidth;
  const agencyStart = respondentStart + 10;
  const yearStart = agencyStart + 1;
  const stateStart = yearStart + 4;
  const countyStart = stateStart + 2;
  const msaStart = countyStart + 3;
  const tractStart = msaStart + shape.msaWidth;
  const assessmentStart = tractStart + 7;
  const partialStart = assessmentStart + 4;
  const splitStart = partialStart + 1;
  const populationStart = splitStart + 1;
  const incomeStart = populationStart + 1;
  const loanStart = incomeStart + 3;
  return {
    kind: "disclosure",
    recordType,
    respondentId: requiredText(record, respondentStart, agencyStart, "respondent ID"),
    agencyCode: integerField(record, agencyStart, yearStart, "agency code", recordType, warnings),
    activityYear: integerField(
      record,
      yearStart,
      stateStart,
      "activity year",
      recordType,
      warnings,
    ),
    state: textField(record, stateStart, countyStart),
    county: textField(record, countyStart, msaStart),
    msaMd: textField(record, msaStart, tractStart),
    censusTract: textField(record, tractStart, assessmentStart),
    assessmentAreaNumber: textField(record, assessmentStart, partialStart),
    partialCountyIndicator: textField(record, partialStart, splitStart),
    splitCountyIndicator: textField(record, splitStart, populationStart),
    populationClassification: textField(record, populationStart, incomeStart),
    incomeGroup: integerField(record, incomeStart, loanStart, "income group", recordType, warnings),
    loanIndicator: textField(record, loanStart, loanStart + 1),
    rawRecord: record,
    warnings,
  };
}

function parseAggregateLoan(
  record: string,
  recordType: CraAggregateLoanRecordType,
): CraAggregateLoanRow {
  const warnings: string[] = [];
  return {
    kind: "aggregate",
    recordType,
    activityYear: integerField(record, 5, 9, "activity year", recordType, warnings),
    loanType: integerField(record, 9, 10, "loan type", recordType, warnings),
    actionTakenType: integerField(record, 10, 11, "action taken type", recordType, warnings),
    state: textField(record, 11, 13),
    county: textField(record, 13, 16),
    msaMd: textField(record, 16, 21),
    censusTract: textField(record, 21, 28),
    splitCountyIndicator: textField(record, 28, 29),
    populationClassification: textField(record, 29, 30),
    incomeGroup: integerField(record, 30, 33, "income group", recordType, warnings),
    reportLevel: integerField(record, 33, 36, "report level", recordType, warnings),
    loanCountUnder100k: integerField(
      record,
      36,
      46,
      "under-$100,000 loan count",
      recordType,
      warnings,
    ),
    loanAmountUnder100kThousands: integerField(
      record,
      46,
      56,
      "under-$100,000 loan amount",
      recordType,
      warnings,
    ),
    loanCount100kTo250k: integerField(
      record,
      56,
      66,
      "$100,000-$250,000 loan count",
      recordType,
      warnings,
    ),
    loanAmount100kTo250kThousands: integerField(
      record,
      66,
      76,
      "$100,000-$250,000 loan amount",
      recordType,
      warnings,
    ),
    loanCountOver250k: integerField(
      record,
      76,
      86,
      "over-$250,000 loan count",
      recordType,
      warnings,
    ),
    loanAmountOver250kThousands: integerField(
      record,
      86,
      96,
      "over-$250,000 loan amount",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanCount: integerField(
      record,
      96,
      106,
      "under-$1 million revenue loan count",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanAmountThousands: integerField(
      record,
      106,
      116,
      "under-$1 million revenue loan amount",
      recordType,
      warnings,
    ),
    rawRecord: record,
    warnings,
  };
}

function parseAggregateLender(
  record: string,
  recordType: CraAggregateLenderRecordType,
): CraAggregateLenderRow {
  const warnings: string[] = [];
  return {
    kind: "aggregate",
    recordType,
    activityYear: integerField(record, 5, 9, "activity year", recordType, warnings),
    loanType: integerField(record, 9, 10, "loan type", recordType, warnings),
    actionTakenType: integerField(record, 10, 11, "action taken type", recordType, warnings),
    state: textField(record, 11, 13),
    county: textField(record, 13, 16),
    msaMd: textField(record, 16, 21),
    respondentId: textField(record, 21, 31),
    agencyCode: integerField(record, 31, 32, "agency code", recordType, warnings),
    lenderCount: integerField(record, 32, 37, "lender count", recordType, warnings),
    reportLevel: integerField(record, 37, 40, "report level", recordType, warnings),
    loanCount: integerField(record, 40, 50, "loan count", recordType, warnings),
    loanAmountThousands: integerField(record, 50, 60, "loan amount", recordType, warnings),
    grossRevenueUnder1mLoanCount: integerField(
      record,
      60,
      70,
      "under-$1 million revenue loan count",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanAmountThousands: integerField(
      record,
      70,
      80,
      "under-$1 million revenue loan amount",
      recordType,
      warnings,
    ),
    rawRecord: record,
    warnings,
  };
}

function parseDisclosureLoan(
  record: string,
  recordType: CraDisclosureLoanRecordType,
): CraDisclosureLoanRow {
  const warnings: string[] = [];
  return {
    kind: "disclosure",
    recordType,
    respondentId: requiredText(record, 5, 15, "respondent ID"),
    agencyCode: integerField(record, 15, 16, "agency code", recordType, warnings),
    activityYear: integerField(record, 16, 20, "activity year", recordType, warnings),
    loanType: integerField(record, 20, 21, "loan type", recordType, warnings),
    actionTakenType: integerField(record, 21, 22, "action taken type", recordType, warnings),
    state: textField(record, 22, 24),
    county: textField(record, 24, 27),
    msaMd: textField(record, 27, 32),
    assessmentAreaNumber: textField(record, 32, 36),
    partialCountyIndicator: textField(record, 36, 37),
    splitCountyIndicator: textField(record, 37, 38),
    populationClassification: textField(record, 38, 39),
    incomeGroup: integerField(record, 39, 42, "income group", recordType, warnings),
    reportLevel: integerField(record, 42, 45, "report level", recordType, warnings),
    loanCountUnder100k: integerField(
      record,
      45,
      55,
      "under-$100,000 loan count",
      recordType,
      warnings,
    ),
    loanAmountUnder100kThousands: integerField(
      record,
      55,
      65,
      "under-$100,000 loan amount",
      recordType,
      warnings,
    ),
    loanCount100kTo250k: integerField(
      record,
      65,
      75,
      "$100,000-$250,000 loan count",
      recordType,
      warnings,
    ),
    loanAmount100kTo250kThousands: integerField(
      record,
      75,
      85,
      "$100,000-$250,000 loan amount",
      recordType,
      warnings,
    ),
    loanCountOver250k: integerField(
      record,
      85,
      95,
      "over-$250,000 loan count",
      recordType,
      warnings,
    ),
    loanAmountOver250kThousands: integerField(
      record,
      95,
      105,
      "over-$250,000 loan amount",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanCount: integerField(
      record,
      105,
      115,
      "under-$1 million revenue loan count",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanAmountThousands: integerField(
      record,
      115,
      125,
      "under-$1 million revenue loan amount",
      recordType,
      warnings,
    ),
    affiliateLoanCount: integerField(
      record,
      125,
      135,
      "affiliate loan count",
      recordType,
      warnings,
    ),
    affiliateLoanAmountThousands: integerField(
      record,
      135,
      145,
      "affiliate loan amount",
      recordType,
      warnings,
    ),
    rawRecord: record,
    warnings,
  };
}

function parseDisclosureAssessmentActivity(
  record: string,
  recordType: "D3-0" | "D4-0",
): CraDisclosureAssessmentActivityRow {
  const warnings: string[] = [];
  return {
    kind: "disclosure",
    recordType,
    respondentId: requiredText(record, 5, 15, "respondent ID"),
    agencyCode: integerField(record, 15, 16, "agency code", recordType, warnings),
    activityYear: integerField(record, 16, 20, "activity year", recordType, warnings),
    loanType: integerField(record, 20, 21, "loan type", recordType, warnings),
    state: textField(record, 21, 23),
    county: textField(record, 23, 26),
    msaMd: textField(record, 26, 31),
    assessmentAreaNumber: textField(record, 31, 35),
    partialCountyIndicator: textField(record, 35, 36),
    splitCountyIndicator: textField(record, 36, 37),
    reportLevel: integerField(record, 37, 39, "report level", recordType, warnings),
    originatedLoanCount: integerField(
      record,
      39,
      49,
      "originated loan count",
      recordType,
      warnings,
    ),
    originatedLoanAmountThousands: integerField(
      record,
      49,
      59,
      "originated loan amount",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanCount: integerField(
      record,
      59,
      69,
      "under-$1 million revenue loan count",
      recordType,
      warnings,
    ),
    grossRevenueUnder1mLoanAmountThousands: integerField(
      record,
      69,
      79,
      "under-$1 million revenue loan amount",
      recordType,
      warnings,
    ),
    purchasedLoanCount: integerField(record, 79, 89, "purchased loan count", recordType, warnings),
    purchasedLoanAmountThousands: integerField(
      record,
      89,
      99,
      "purchased loan amount",
      recordType,
      warnings,
    ),
    rawRecord: record,
    warnings,
  };
}

function parseDisclosureCommunityDevelopment(record: string): CraDisclosureCommunityDevelopmentRow {
  const recordType = "D5-0";
  const warnings: string[] = [];
  return {
    kind: "disclosure",
    recordType,
    respondentId: requiredText(record, 5, 15, "respondent ID"),
    agencyCode: integerField(record, 15, 16, "agency code", recordType, warnings),
    activityYear: integerField(record, 16, 20, "activity year", recordType, warnings),
    loanType: integerField(record, 20, 21, "loan type", recordType, warnings),
    loanCount: integerField(record, 21, 31, "loan count", recordType, warnings),
    loanAmountThousands: integerField(record, 31, 41, "loan amount", recordType, warnings),
    affiliateLoanCount: integerField(record, 41, 51, "affiliate loan count", recordType, warnings),
    affiliateLoanAmountThousands: integerField(
      record,
      51,
      61,
      "affiliate loan amount",
      recordType,
      warnings,
    ),
    actionType: textField(record, 61, 62),
    rawRecord: record,
    warnings,
  };
}

function parseDisclosureAssessmentArea(record: string): CraDisclosureAssessmentAreaRow {
  const recordType = "D6-0";
  const warnings: string[] = [];
  return {
    kind: "disclosure",
    recordType,
    respondentId: requiredText(record, 5, 15, "respondent ID"),
    agencyCode: integerField(record, 15, 16, "agency code", recordType, warnings),
    activityYear: integerField(record, 16, 20, "activity year", recordType, warnings),
    state: textField(record, 20, 22),
    county: textField(record, 22, 25),
    msaMd: textField(record, 25, 30),
    censusTract: textField(record, 30, 37),
    assessmentAreaNumber: textField(record, 37, 41),
    partialCountyIndicator: textField(record, 41, 42),
    splitCountyIndicator: textField(record, 42, 43),
    populationClassification: textField(record, 43, 44),
    incomeGroup: integerField(record, 44, 47, "income group", recordType, warnings),
    loanIndicator: textField(record, 47, 48),
    rawRecord: record,
    warnings,
  };
}

function integerField(
  record: string,
  start: number,
  end: number,
  field: string,
  recordType: string,
  warnings: string[],
): number | undefined {
  const raw = record.slice(start, end);
  const value = raw.trim();
  if (value === "") return undefined;
  if (!/^\d+$/.test(value)) {
    warnings.push(`CRA ${recordType}: could not coerce ${field} ${JSON.stringify(raw)}`);
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    warnings.push(`CRA ${recordType}: could not coerce ${field} ${JSON.stringify(raw)}`);
    return undefined;
  }
  return parsed;
}

function textField(record: string, start: number, end: number): string | undefined {
  const value = record.slice(start, end).trim();
  return value === "" ? undefined : value;
}

function requiredText(record: string, start: number, end: number, field: string): string {
  const value = textField(record, start, end);
  if (value === undefined) throw new Error(`CRA fixed-width record is missing required ${field}`);
  return value;
}

function validateParsedYear(year: number): void {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new RangeError(
      `CRA activity year must be a four-digit integer; received ${String(year)}`,
    );
  }
}

function* fixedWidthLines(text: string): Generator<string> {
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const contentEnd = end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    yield text.slice(start, contentEnd);
    if (newline === -1) return;
    start = newline + 1;
  }
}
