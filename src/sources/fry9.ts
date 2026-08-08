import { parsePublishedAt } from "../dates.js";
import { XnewsFetchError } from "../errors.js";
import { fetchRaw } from "../http.js";
import { normalizeLimit } from "../options.js";
import { decodeEntities } from "../text.js";
import { readZipEntries, type ZipEntry } from "../zip.js";
import {
  FRY9_FINANCIAL_DATA_URL,
  FRY9_FIRST_YEAR,
  FRY9_PROVIDER_ID,
  FRY9_REPORTS,
  fry9ArchiveName,
  fry9ArchiveUrl,
  fry9FinancialDataPageUrl,
  fry9PeriodReports,
  fry9ReportDefinition,
  fry9ReportingPeriod,
  fry9ReportPeriod,
} from "./fry9.urls.js";
import type { Fry9LineItemFamily, Fry9Report, Fry9ReportDefinition } from "./fry9.urls.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";

export {
  FRY9_ARCHIVE_DOWNLOAD_URL,
  FRY9_DATA_DICTIONARY_URL,
  FRY9_FINANCIAL_DATA_URL,
  FRY9_FIRST_YEAR,
  FRY9_PROVIDER_ID,
  FRY9_REPORTS,
  fry9ArchiveName,
  fry9ArchiveUrl,
  fry9FinancialDataPageUrl,
  fry9PeriodReports,
  fry9ReportDefinition,
  fry9ReportingPeriod,
  fry9ReportPeriod,
} from "./fry9.urls.js";
export type {
  Fry9Cadence,
  Fry9LineItemFamily,
  Fry9Report,
  Fry9ReportDefinition,
} from "./fry9.urls.js";

/**
 * NPW's full quarterly archives can exceed the shared 32 MiB response cap.
 * The ZIP reader separately limits expanded data to its 512 MiB budget.
 */
export const FRY9_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;

export interface Fry9Period {
  /** ISO reporting-period end stated in the filename and every data row. */
  readonly periodEnd: string;
  readonly archiveName: string;
  /** Forms collected for this quarter under NPW's published cadence. */
  readonly reports: readonly Fry9Report[];
}

/** Authoritative form metadata and periods parsed from one NPW catalog page. */
export interface Fry9Page {
  readonly reports: readonly Fry9ReportDefinition[];
  readonly years: readonly number[];
  readonly periods: readonly Fry9Period[];
  readonly selectedYear?: number;
  readonly delimiter: "^";
  readonly refreshSchedule: "weekdays-around-05:00-EST";
  readonly filingDeadlineDays: 45;
}

/** One holding-company filing row for one form and reporting period. */
export interface Fry9Row {
  /** Federal Reserve entity identifier and FFIEC Call Report join key. */
  readonly rssdId?: number;
  readonly name?: string;
  readonly report: Fry9Report;
  readonly periodEnd: string;
  /** Non-empty MDRM items belonging to the selected form. */
  readonly values: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
  /** Caret-delimited publisher row, byte-for-byte after archive decoding. */
  readonly raw: string;
}

export interface Fry9ParseOptions {
  readonly expectedPeriodEnd?: string;
  readonly rssdIds?: readonly number[];
  readonly lineItems?: readonly string[];
  readonly limit?: number;
}

export interface Fry9DataOptions extends DataFetchOptions {
  /** Reporting period; defaults to the latest period offered for the form. */
  readonly period?: string;
  readonly rssdIds?: readonly number[];
  readonly lineItems?: readonly string[];
  readonly limit?: number;
}

export interface Fry9Download {
  readonly report: Fry9Report;
  readonly periodEnd: string;
  readonly filename: string;
  readonly contentType?: string;
  readonly bytes: Uint8Array;
}

const PAGE_SHAPE_ERROR = "FR Y-9 financial download page has an unexpected structure";
const ARCHIVE_SHAPE_ERROR = "FR Y-9 archive is malformed";
const TEXT_SHAPE_ERROR = "FR Y-9 text has an unexpected payload shape";
const FORM_ID = /FR\s+Y-9(?:C|LP|SP)\b/gi;
const YEAR_SELECT = /<select\b[^>]*\bid\s*=\s*(["'])DropDownlistYears\1[^>]*>([\s\S]*?)<\/select>/i;
const YEAR_OPTION = /<option\b[^>]*>([\s\S]*?)<\/option>/gi;
const ARCHIVE_ACTION =
  /onclick\s*=\s*(["'])ReturnBHCFZipFiles\(\s*(["'])(BHCF\d{8}\.ZIP)\2\s*\)\1/gi;
const DOWNLOAD_FUNCTION =
  /function\s+ReturnBHCFZipFiles\s*\(\s*filename\s*\)\s*\{[\s\S]*?window\.location\.href\s*=\s*(["'])\.\.\/FinancialReport\/ReturnBHCFZipFiles\1\s*\+\s*(["'])\?zipfilename=\2\s*\+\s*filename\s*;?[\s\S]*?\}/i;
const REPORT_LIST = /Financial data are available for:\s*<ul>([\s\S]*?)<\/ul>/i;
const MDRM_ITEM = /^[A-Z0-9]{8}$/;
const textDecoder = new TextDecoder("windows-1252");
const htmlDecoder = new TextDecoder("utf-8", { fatal: true });

/** Parses the authoritative NPW report list, cadence, and offered periods. */
export function parseFry9Page(html: string): Fry9Page {
  if (!DOWNLOAD_FUNCTION.test(html)) throw new Error(PAGE_SHAPE_ERROR);

  const visibleText = htmlText(html);
  if (
    !visibleText.includes("45-calendar day deadline for Y-9 reporting") ||
    !visibleText.includes("delimited by the caret symbol (^)") ||
    !visibleText.includes("Data is refreshed daily around 5:00am (EST), Monday through Friday") ||
    !visibleText.includes(
      "Financial and some structure items for all three reports are contained in one row",
    ) ||
    !visibleText.includes("Files are not available by report") ||
    !visibleText.includes("FR Y-9C and FR Y-9LP data are collected quarterly") ||
    !visibleText.includes("FR Y-9SP is collected semiannually")
  ) {
    throw new Error(PAGE_SHAPE_ERROR);
  }

  const reportList = REPORT_LIST.exec(html)?.[1];
  const reportText = reportList === undefined ? "" : htmlText(reportList);
  const formIds = [...reportText.matchAll(FORM_ID)].map((match) =>
    (match[0] ?? "").replaceAll(/\s+/g, " ").toUpperCase(),
  );
  if (
    formIds.length !== FRY9_REPORTS.length ||
    FRY9_REPORTS.some((definition) => !formIds.includes(definition.formId)) ||
    !reportText.includes("all domestic holding companies on a consolidated basis") ||
    !reportText.includes(
      "all large domestic holding companies on an unconsolidated parent only basis",
    ) ||
    !reportText.includes("all small domestic holding companies on an unconsolidated parent basis")
  ) {
    throw new Error(PAGE_SHAPE_ERROR);
  }

  const yearSelect = YEAR_SELECT.exec(html)?.[2];
  if (yearSelect === undefined) throw new Error(PAGE_SHAPE_ERROR);
  const years = [...yearSelect.matchAll(YEAR_OPTION)]
    .map((match) => htmlText(match[1] ?? ""))
    .filter((value) => /^\d{4}$/.test(value))
    .map(Number);
  if (
    years.length === 0 ||
    new Set(years).size !== years.length ||
    years.some((year) => year < FRY9_FIRST_YEAR)
  ) {
    throw new Error(PAGE_SHAPE_ERROR);
  }

  const archiveNames = [...html.matchAll(ARCHIVE_ACTION)].map((match) => match[3] ?? "");
  if (new Set(archiveNames).size !== archiveNames.length) throw new Error(PAGE_SHAPE_ERROR);
  const periods = archiveNames.map((archiveName) => periodFromArchiveName(archiveName, html));
  const selectedYears = new Set(periods.map((period) => Number(period.periodEnd.slice(0, 4))));
  if (selectedYears.size > 1) throw new Error(PAGE_SHAPE_ERROR);
  const selectedYear =
    periods[0] === undefined ? undefined : Number(periods[0].periodEnd.slice(0, 4));
  if (selectedYear !== undefined && !years.includes(selectedYear))
    throw new Error(PAGE_SHAPE_ERROR);

  return {
    reports: FRY9_REPORTS,
    years,
    periods,
    ...(selectedYear === undefined ? {} : { selectedYear }),
    delimiter: "^",
    refreshSchedule: "weekdays-around-05:00-EST",
    filingDeadlineDays: 45,
  };
}

/** Fetches and validates the base catalog or one selected-year period list. */
export async function fetchFry9Page(
  year?: number,
  options: SourceFetchOptions = {},
): Promise<Fry9Page> {
  const url = fry9FinancialDataPageUrl(year);
  const result = await fetchRaw(url, options);
  try {
    const contentType = (result.contentType ?? "").toLowerCase();
    if (contentType !== "" && !contentType.includes("html")) throw new Error(PAGE_SHAPE_ERROR);
    return parseFry9Page(htmlDecoder.decode(result.bytes));
  } catch {
    throw new XnewsFetchError("network", PAGE_SHAPE_ERROR, { url });
  }
}

/** Lists the periods NPW currently offers for one year. */
export async function fetchFry9Periods(
  year: number,
  options: SourceFetchOptions = {},
): Promise<readonly Fry9Period[]> {
  return (await fetchFry9Page(year, options)).periods;
}

/**
 * Downloads one combined quarterly BHCF archive through the direct GET action.
 * The request carries the selected-year page as its `Referer` because that page
 * is where NPW publishes the link; measured cold requests can still answer 403
 * with a block page and then serve the retry, so a lone 403 here is a transient
 * edge decision rather than a missing credential.
 */
export async function downloadFry9Archive(
  report: Fry9Report,
  periodEnd: string,
  options: SourceFetchOptions = {},
): Promise<Fry9Download> {
  const normalizedPeriod = fry9ReportPeriod(report, periodEnd);
  const url = fry9ArchiveUrl(report, normalizedPeriod);
  const result = await fetchRaw(
    url,
    {
      ...options,
      maxResponseBytes: options.maxResponseBytes ?? FRY9_ARCHIVE_MAX_BYTES,
    },
    { headers: { Referer: fry9FinancialDataPageUrl(Number(normalizedPeriod.slice(0, 4))) } },
  );
  const contentType = (result.contentType ?? "").toLowerCase();
  const hasZipMagic =
    result.bytes[0] === 0x50 && result.bytes[1] === 0x4b && result.bytes[2] === 0x03;
  if (!contentType.includes("zip") || !hasZipMagic) {
    throw new XnewsFetchError("network", "FR Y-9 download did not return a ZIP archive", {
      url,
    });
  }
  return {
    report,
    periodEnd: normalizedPeriod,
    filename: fry9ArchiveName(report, normalizedPeriod),
    ...(result.contentType === undefined ? {} : { contentType: result.contentType }),
    bytes: result.bytes,
  };
}

/**
 * NPW uses carets because commas occur in values, and unquoted line breaks
 * also occur inside text fields, so neither RFC 4180 parsing nor line splitting
 * preserves its logical rows.
 */
export function parseFry9Text(
  body: string,
  report: Fry9Report,
  options: Fry9ParseOptions = {},
): Fry9Row[] {
  const definition = fry9ReportDefinition(report);
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const records = parseCaretRecords(body);
  const headerLine =
    records.header.charCodeAt(0) === 0xfeff ? records.header.slice(1) : records.header;
  const header = headerLine.split("^");
  if (
    new Set(header).size !== header.length ||
    header.some((item) => !MDRM_ITEM.test(item)) ||
    !header.includes("RSSD9001") ||
    !header.includes("RSSD9999") ||
    !header.includes("RSSD9017")
  ) {
    throw new Error(TEXT_SHAPE_ERROR);
  }

  const rssdIndex = header.indexOf("RSSD9001");
  const periodIndex = header.indexOf("RSSD9999");
  const nameIndex = header.indexOf("RSSD9017");
  const membershipIndexes = header.flatMap((item, index) =>
    isReportFinancialItem(item, definition.lineItemFamily) ? [index] : [],
  );
  if (membershipIndexes.length === 0) throw new Error(TEXT_SHAPE_ERROR);

  const lineItemFilter = normalizeLineItemFilter(options.lineItems);
  const valueIndexes = header.flatMap((item, index) =>
    (isReportFinancialItem(item, definition.lineItemFamily) || item.startsWith("TEXT")) &&
    (lineItemFilter === undefined || lineItemFilter.has(item))
      ? [index]
      : [],
  );
  const rssdFilter = options.rssdIds === undefined ? undefined : new Set(options.rssdIds);
  const expectedPeriod =
    options.expectedPeriodEnd === undefined
      ? undefined
      : fry9ReportPeriod(report, options.expectedPeriodEnd);
  let observedPeriod: string | undefined;
  const rows: Fry9Row[] = [];

  for (const raw of records.rows) {
    const cells = raw.split("^");
    if (cells.length !== header.length) throw new Error(`${TEXT_SHAPE_ERROR}: truncated row`);
    const periodEnd = compactPeriod(cells[periodIndex] ?? "");
    if (periodEnd === undefined) throw new Error(`${TEXT_SHAPE_ERROR}: invalid reporting period`);
    if (observedPeriod !== undefined && periodEnd !== observedPeriod) {
      throw new Error(`${TEXT_SHAPE_ERROR}: mixed reporting periods`);
    }
    if (expectedPeriod !== undefined && periodEnd !== expectedPeriod) {
      throw new Error(`${TEXT_SHAPE_ERROR}: reporting period mismatch`);
    }
    observedPeriod = periodEnd;

    if (!membershipIndexes.some((index) => (cells[index] ?? "").trim() !== "")) continue;
    const warnings: string[] = [];
    const rawRssdId = cells[rssdIndex] ?? "";
    const rssdId = optionalRssdId(rawRssdId, warnings);
    if (rssdFilter !== undefined && (rssdId === undefined || !rssdFilter.has(rssdId))) continue;

    const values: Record<string, string> = {};
    for (const index of valueIndexes) {
      const value = cells[index] ?? "";
      if (value !== "") values[header[index]!] = value;
    }
    if (lineItemFilter !== undefined && Object.keys(values).length === 0) continue;
    if (limit !== undefined && rows.length >= limit) continue;

    const name = (cells[nameIndex] ?? "").trim();
    rows.push({
      ...(rssdId === undefined ? {} : { rssdId }),
      ...(name === "" ? {} : { name }),
      report: definition.report,
      periodEnd,
      values,
      warnings,
      raw,
    });
  }

  if (observedPeriod === undefined) throw new Error(TEXT_SHAPE_ERROR);
  fry9ReportPeriod(report, observedPeriod);
  return rows;
}

/** Unzips and parses the single period text entry expected from NPW. */
export async function parseFry9Archive(
  archive: Uint8Array,
  report: Fry9Report,
  periodEnd: string,
  options: Omit<Fry9ParseOptions, "expectedPeriodEnd"> = {},
): Promise<Fry9Row[]> {
  const normalizedPeriod = fry9ReportPeriod(report, periodEnd);
  let entries: readonly ZipEntry[];
  try {
    entries = await readZipEntries(archive, `${report} ${normalizedPeriod} archive`);
  } catch {
    throw new Error(ARCHIVE_SHAPE_ERROR);
  }
  const expectedName = fry9ArchiveName(report, normalizedPeriod).replace(/\.ZIP$/i, ".txt");
  if (entries.length !== 1 || entries[0]?.name.toLowerCase() !== expectedName.toLowerCase()) {
    throw new Error(ARCHIVE_SHAPE_ERROR);
  }
  return parseFry9Text(textDecoder.decode(entries[0].bytes), report, {
    ...options,
    expectedPeriodEnd: normalizedPeriod,
  });
}

/** Fetches one form-period slice of the combined NPW archive. */
export async function fetchFry9Data(
  report: Fry9Report,
  options: Fry9DataOptions = {},
): Promise<DataRelease<Fry9Row> | undefined> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return undefined;
  fry9ReportDefinition(report);
  validateIfNewerThan(options.ifNewerThan);

  const period = await resolveFry9Period(report, options);
  if (options.ifNewerThan !== undefined && period.periodEnd <= options.ifNewerThan) {
    return undefined;
  }
  const download = await downloadFry9Archive(report, period.periodEnd, options);
  let rows: readonly Fry9Row[];
  try {
    rows = await parseFry9Archive(download.bytes, report, period.periodEnd, {
      ...(options.rssdIds === undefined ? {} : { rssdIds: options.rssdIds }),
      ...(options.lineItems === undefined ? {} : { lineItems: options.lineItems }),
      ...(limit === undefined ? {} : { limit }),
    });
  } catch {
    throw new XnewsFetchError("network", ARCHIVE_SHAPE_ERROR, {
      url: fry9ArchiveUrl(report, period.periodEnd),
    });
  }

  return {
    provider: FRY9_PROVIDER_ID,
    dataset: report,
    asOf: period.periodEnd,
    url: FRY9_FINANCIAL_DATA_URL,
    rows,
  };
}

/** Binds one FR Y-9 form to the generic structured-data lane. */
export function fry9DataSource(
  report: Fry9Report,
  options: Fry9DataOptions = {},
): DataSource<Fry9Row> {
  const definition = fry9ReportDefinition(report);
  const merged = (fetchOptions: DataFetchOptions): Fry9DataOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: FRY9_PROVIDER_ID,
    dataset: definition.report,
    requestUrls: (fetchOptions = {}) => {
      const effective = merged(fetchOptions);
      if (normalizeLimit(effective.limit) === 0) return [];
      if (effective.period === undefined) return [FRY9_FINANCIAL_DATA_URL];
      const periodEnd = fry9ReportPeriod(report, effective.period);
      return [
        fry9FinancialDataPageUrl(Number(periodEnd.slice(0, 4))),
        fry9ArchiveUrl(report, periodEnd),
      ];
    },
    fetchRelease: (fetchOptions = {}) => fetchFry9Data(report, merged(fetchOptions)),
  };
}

async function resolveFry9Period(
  report: Fry9Report,
  options: Fry9DataOptions,
): Promise<Fry9Period> {
  if (options.period !== undefined) {
    const periodEnd = fry9ReportPeriod(report, options.period);
    const page = await fetchFry9Page(Number(periodEnd.slice(0, 4)), options);
    const period = page.periods.find(
      (candidate) => candidate.periodEnd === periodEnd && candidate.reports.includes(report),
    );
    if (period === undefined) {
      throw new RangeError(`${report} period ${periodEnd} is not available from NPW`);
    }
    return period;
  }

  const catalog = await fetchFry9Page(undefined, options);
  for (const year of catalog.years.toSorted((left, right) => right - left)) {
    const page = await fetchFry9Page(year, options);
    const period = page.periods
      .filter((candidate) => candidate.reports.includes(report))
      .toSorted((left, right) => right.periodEnd.localeCompare(left.periodEnd))[0];
    if (period !== undefined) return period;
  }
  throw new XnewsFetchError("network", "NPW lists no available FR Y-9 periods", {
    url: FRY9_FINANCIAL_DATA_URL,
  });
}

function periodFromArchiveName(archiveName: string, html: string): Fry9Period {
  const compact = /^BHCF(\d{8})\.ZIP$/i.exec(archiveName)?.[1];
  const periodEnd = compact === undefined ? undefined : compactPeriod(compact);
  const escapedName = archiveName.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const label = new RegExp(
    `<span\\b[^>]*class\\s*=\\s*(["'])[^"']*\\blink-text-align-svg\\b[^"']*\\1[^>]*>\\s*${escapedName}\\s*<\\/span>`,
    "i",
  );
  if (periodEnd === undefined || !label.test(html)) throw new Error(PAGE_SHAPE_ERROR);
  return {
    periodEnd,
    archiveName,
    reports: fry9PeriodReports(periodEnd),
  };
}

function compactPeriod(value: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (match === null) return undefined;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  try {
    return fry9ReportingPeriod(iso);
  } catch {
    return undefined;
  }
}

interface PhysicalLine {
  readonly text: string;
  readonly ending: string;
}

function parseCaretRecords(body: string): {
  readonly header: string;
  readonly rows: readonly string[];
} {
  const physicalLines: PhysicalLine[] = [];
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character !== "\r" && character !== "\n") continue;
    const endingLength = character === "\r" && body[index + 1] === "\n" ? 2 : 1;
    physicalLines.push({
      text: body.slice(start, index),
      ending: body.slice(index, index + endingLength),
    });
    index += endingLength - 1;
    start = index + 1;
  }
  if (start < body.length) {
    physicalLines.push({ text: body.slice(start), ending: "" });
  }

  const headerLine = physicalLines[0];
  if (headerLine === undefined || headerLine.text === "" || physicalLines.length < 2) {
    throw new Error(TEXT_SHAPE_ERROR);
  }
  let expectedCarets = 0;
  for (const character of headerLine.text) {
    if (character === "^") expectedCarets += 1;
  }
  if (expectedCarets === 0) throw new Error(TEXT_SHAPE_ERROR);

  const rows: string[] = [];
  let raw = "";
  let observedCarets = 0;
  for (let index = 1; index < physicalLines.length; index += 1) {
    const line = physicalLines[index]!;
    if (raw === "" && line.text === "") throw new Error(TEXT_SHAPE_ERROR);
    raw += line.text;
    for (const character of line.text) {
      if (character === "^") observedCarets += 1;
    }
    if (observedCarets > expectedCarets) {
      throw new Error(`${TEXT_SHAPE_ERROR}: truncated row`);
    }

    const next = physicalLines[index + 1];
    const nextStartsRecord = next === undefined || /^[^^]*\^\d{8}\^/.test(next.text);
    if (observedCarets === expectedCarets && nextStartsRecord) {
      rows.push(raw);
      raw = "";
      observedCarets = 0;
    } else {
      if (line.ending === "") throw new Error(`${TEXT_SHAPE_ERROR}: truncated row`);
      raw += line.ending;
    }
  }
  if (raw !== "" || rows.length === 0) throw new Error(`${TEXT_SHAPE_ERROR}: truncated row`);
  return { header: headerLine.text, rows };
}

function htmlText(value: string): string {
  return decodeEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function isReportFinancialItem(item: string, family: Fry9LineItemFamily): boolean {
  if (!item.startsWith("BH")) return false;
  const parent = item.startsWith("BHCP") || item.startsWith("BHPA") || item.startsWith("BHPX");
  if (family === "parent") return parent;
  if (family === "small") return item.startsWith("BHS");
  return !parent && !item.startsWith("BHS");
}

function normalizeLineItemFilter(
  lineItems: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (lineItems === undefined) return undefined;
  const normalized = lineItems.map((item) => item.trim().toUpperCase());
  if (normalized.some((item) => !MDRM_ITEM.test(item))) {
    throw new RangeError("FR Y-9 lineItems must contain eight-character MDRM item names");
  }
  return new Set(normalized);
}

function optionalRssdId(raw: string, warnings: string[]): number | undefined {
  const text = raw.trim();
  const value = Number(text);
  if (text === "" || !Number.isSafeInteger(value) || value <= 0) {
    warnings.push(`RSSD9001 is not a positive safe integer: ${JSON.stringify(raw)}`);
    return undefined;
  }
  return value;
}

function validateIfNewerThan(value: string | undefined): void {
  if (value === undefined) return;
  const parsed = parsePublishedAt(value);
  if (parsed?.format !== "date_only" || parsed.instant.slice(0, 10) !== value) {
    throw new XnewsFetchError("config", "ifNewerThan must be an ISO date in YYYY-MM-DD form", {
      url: FRY9_FINANCIAL_DATA_URL,
    });
  }
}
