import { parsePublishedAt } from "../dates.js";
import { XnewsFetchError } from "../errors.js";
import { fetchRaw } from "../http.js";
import { cleanText, decodeEntities } from "../text.js";
import { readXlsx } from "../xlsx.js";
import { readZipEntries } from "../zip.js";
import {
  FFIEC_E16_DATA_PATH,
  FFIEC_E16_INDEX_URL,
  FFIEC_E16_PROVIDER_ID,
  ffiecE16FormatFromUrl,
} from "./ffiece16.urls.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import type { XlsxCellValue, XlsxSheet } from "../xlsx.js";
import type { FfiecE16ReleaseEntry, FfiecE16ReleaseFormat } from "./ffiece16.urls.js";

export {
  FFIEC_E16_DATA_PATH,
  FFIEC_E16_INDEX_URL,
  FFIEC_E16_PROVIDER_ID,
  ffiecE16FormatFromUrl,
} from "./ffiece16.urls.js";
export type { FfiecE16ReleaseEntry, FfiecE16ReleaseFormat } from "./ffiece16.urls.js";

/** Current E.16 workbooks are about 0.2 MiB; this ceiling allows ample growth. */
export const FFIEC_E16_MAX_BYTES = 8 * 1024 * 1024;

export type FfiecE16Population = "all-banks" | "large-financial-institutions" | "all-other-banks";
export type FfiecE16Table = "1" | "2" | "3" | "4.1" | "4.2";
export type FfiecE16RowKind = "country-or-organization" | "region-total" | "grand-total";

export type FfiecE16MeasureName =
  | "ultimateRiskCrossBorderClaims"
  | "ultimateRiskLocalResidentClaims"
  | "ultimateRiskLocalResidentNonLocalCurrencyClaims"
  | "ultimateRiskLocalResidentLocalCurrencyClaims"
  | "derivativeFairValueClaims"
  | "countryRiskClaims"
  | "unusedCommitments"
  | "guaranteesExcludingCreditDerivatives"
  | "grossCreditDerivativesSold"
  | "grossCreditDerivativesPurchased"
  | "grossMinusNetCreditDerivativesSold"
  | "grossMinusNetCreditDerivativesPurchased"
  | "tradeFinance"
  | "immediateRiskCrossBorderClaims"
  | "immediateRiskLocalResidentNonLocalCurrencyClaims"
  | "claimsMaturingWithinOneYear"
  | "immediateRiskLocalResidentLocalCurrencyClaims"
  | "immediateRiskTotalClaims"
  | "outwardRiskTransfers"
  | "inwardRiskTransfers"
  | "ultimateRiskTotalClaimsExcludingDerivatives"
  | "foreignOfficeLiabilitiesNonLocalCurrency"
  | "foreignOfficeLiabilitiesLocalCurrency"
  | "foreignOfficeLiabilitiesTotal"
  | "foreignOfficeLiabilitiesByCreditorCountry"
  | "netDueToRelatedOffices"
  | "securitiesHeldToMaturityAndAvailableForSale"
  | "assetsHeldForTrading"
  | "offsettingTradingBookPositions"
  | "collateralizedClaimsTotal"
  | "collateralizedClaimsCash"
  | "collateralizedClaimsSameCountry"
  | "collateralizedClaimsResaleAndSecuritiesLending"
  | "bankingUltimateCrossBorderClaims"
  | "bankingUltimateLocalResidentClaims"
  | "bankingUltimateDerivativeFairValueClaims"
  | "bankingUltimateTotalClaims"
  | "bankingImmediateCrossBorderClaims"
  | "bankingImmediateLocalResidentNonLocalCurrencyClaims"
  | "publicUltimateCrossBorderClaims"
  | "publicUltimateLocalResidentClaims"
  | "publicUltimateDerivativeFairValueClaims"
  | "publicUltimateTotalClaims"
  | "publicImmediateCrossBorderClaims"
  | "publicImmediateLocalResidentNonLocalCurrencyClaims"
  | "nonBankFinancialUltimateCrossBorderClaims"
  | "nonBankFinancialUltimateLocalResidentClaims"
  | "nonBankFinancialUltimateDerivativeFairValueClaims"
  | "nonBankFinancialUltimateTotalClaims"
  | "nonBankFinancialImmediateCrossBorderClaims"
  | "nonBankFinancialImmediateLocalResidentNonLocalCurrencyClaims"
  | "otherUltimateCrossBorderCorporateClaims"
  | "otherUltimateCrossBorderHouseholdClaims"
  | "otherUltimateCrossBorderTotalClaims"
  | "otherUltimateLocalResidentCorporateClaims"
  | "otherUltimateLocalResidentHouseholdClaims"
  | "otherUltimateLocalResidentTotalClaims"
  | "otherUltimateDerivativeFairValueClaims"
  | "otherUltimateTotalClaims"
  | "otherImmediateCrossBorderCorporateClaims"
  | "otherImmediateCrossBorderHouseholdClaims"
  | "otherImmediateCrossBorderTotalClaims"
  | "otherImmediateLocalResidentCorporateClaims"
  | "otherImmediateLocalResidentHouseholdClaims"
  | "otherImmediateLocalResidentTotalClaims";

export interface FfiecE16ExposureMeasure {
  readonly name: FfiecE16MeasureName;
  readonly raw: XlsxCellValue;
  readonly value?: number;
}

/** One country, organization, subtotal, or grand-total row from an E.16 table. */
export interface FfiecE16CountryExposureRow {
  readonly reportingPeriod: string;
  readonly population: FfiecE16Population;
  readonly populationLabel: string;
  readonly table: FfiecE16Table;
  readonly countryOrRegion: string;
  readonly region?: string;
  readonly rowKind: FfiecE16RowKind;
  readonly measures: readonly FfiecE16ExposureMeasure[];
  readonly raw: readonly XlsxCellValue[];
  readonly warnings: readonly string[];
}

export interface FfiecE16Workbook {
  readonly reportingPeriod: string;
  readonly sheetNames: readonly string[];
  readonly rows: readonly FfiecE16CountryExposureRow[];
}

export interface FfiecE16ParseOptions {
  readonly limit?: number;
}

export interface FfiecE16Release extends DataRelease<FfiecE16CountryExposureRow> {
  readonly entry: FfiecE16ReleaseEntry;
  readonly sheetNames: readonly string[];
}

export interface FfiecE16DataOptions extends DataFetchOptions {
  readonly limit?: number;
}

interface MeasureSpec {
  readonly column: number;
  readonly name: FfiecE16MeasureName;
}

interface SheetDefinition {
  readonly population: FfiecE16Population;
  readonly populationLabel: string;
  readonly table: FfiecE16Table;
}

const TABLE_VALUES: readonly FfiecE16Table[] = ["1", "2", "3", "4.1", "4.2"];
const TABLE_MEASURES: Readonly<Record<FfiecE16Table, readonly MeasureSpec[]>> = {
  "1": [
    { column: 2, name: "ultimateRiskCrossBorderClaims" },
    { column: 3, name: "ultimateRiskLocalResidentClaims" },
    { column: 4, name: "ultimateRiskLocalResidentNonLocalCurrencyClaims" },
    { column: 5, name: "ultimateRiskLocalResidentLocalCurrencyClaims" },
    { column: 6, name: "derivativeFairValueClaims" },
    { column: 7, name: "countryRiskClaims" },
    { column: 9, name: "unusedCommitments" },
    { column: 10, name: "guaranteesExcludingCreditDerivatives" },
    { column: 11, name: "grossCreditDerivativesSold" },
    { column: 12, name: "grossCreditDerivativesPurchased" },
    { column: 13, name: "grossMinusNetCreditDerivativesSold" },
    { column: 15, name: "grossMinusNetCreditDerivativesPurchased" },
    { column: 16, name: "tradeFinance" },
  ],
  "2": [
    { column: 2, name: "immediateRiskCrossBorderClaims" },
    { column: 3, name: "immediateRiskLocalResidentNonLocalCurrencyClaims" },
    { column: 4, name: "claimsMaturingWithinOneYear" },
    { column: 5, name: "immediateRiskLocalResidentLocalCurrencyClaims" },
    { column: 6, name: "immediateRiskTotalClaims" },
    { column: 7, name: "outwardRiskTransfers" },
    { column: 8, name: "inwardRiskTransfers" },
    { column: 9, name: "ultimateRiskTotalClaimsExcludingDerivatives" },
  ],
  "3": [
    { column: 2, name: "foreignOfficeLiabilitiesNonLocalCurrency" },
    { column: 3, name: "foreignOfficeLiabilitiesLocalCurrency" },
    { column: 4, name: "foreignOfficeLiabilitiesTotal" },
    { column: 5, name: "foreignOfficeLiabilitiesByCreditorCountry" },
    { column: 6, name: "netDueToRelatedOffices" },
    { column: 8, name: "securitiesHeldToMaturityAndAvailableForSale" },
    { column: 9, name: "assetsHeldForTrading" },
    { column: 10, name: "offsettingTradingBookPositions" },
    { column: 11, name: "collateralizedClaimsTotal" },
    { column: 12, name: "collateralizedClaimsCash" },
    { column: 13, name: "collateralizedClaimsSameCountry" },
    { column: 15, name: "collateralizedClaimsResaleAndSecuritiesLending" },
  ],
  "4.1": [
    { column: 2, name: "bankingUltimateCrossBorderClaims" },
    { column: 3, name: "bankingUltimateLocalResidentClaims" },
    { column: 4, name: "bankingUltimateDerivativeFairValueClaims" },
    { column: 5, name: "bankingUltimateTotalClaims" },
    { column: 6, name: "bankingImmediateCrossBorderClaims" },
    { column: 7, name: "bankingImmediateLocalResidentNonLocalCurrencyClaims" },
    { column: 8, name: "publicUltimateCrossBorderClaims" },
    { column: 9, name: "publicUltimateLocalResidentClaims" },
    { column: 10, name: "publicUltimateDerivativeFairValueClaims" },
    { column: 11, name: "publicUltimateTotalClaims" },
    { column: 12, name: "publicImmediateCrossBorderClaims" },
    { column: 13, name: "publicImmediateLocalResidentNonLocalCurrencyClaims" },
    { column: 14, name: "nonBankFinancialUltimateCrossBorderClaims" },
    { column: 15, name: "nonBankFinancialUltimateLocalResidentClaims" },
    { column: 16, name: "nonBankFinancialUltimateDerivativeFairValueClaims" },
    { column: 17, name: "nonBankFinancialUltimateTotalClaims" },
    { column: 19, name: "nonBankFinancialImmediateCrossBorderClaims" },
    { column: 20, name: "nonBankFinancialImmediateLocalResidentNonLocalCurrencyClaims" },
  ],
  "4.2": [
    { column: 2, name: "otherUltimateCrossBorderCorporateClaims" },
    { column: 3, name: "otherUltimateCrossBorderHouseholdClaims" },
    { column: 4, name: "otherUltimateCrossBorderTotalClaims" },
    { column: 5, name: "otherUltimateLocalResidentCorporateClaims" },
    { column: 6, name: "otherUltimateLocalResidentHouseholdClaims" },
    { column: 7, name: "otherUltimateLocalResidentTotalClaims" },
    { column: 8, name: "otherUltimateDerivativeFairValueClaims" },
    { column: 9, name: "otherUltimateTotalClaims" },
    { column: 10, name: "otherImmediateCrossBorderCorporateClaims" },
    { column: 11, name: "otherImmediateCrossBorderHouseholdClaims" },
    { column: 12, name: "otherImmediateCrossBorderTotalClaims" },
    { column: 13, name: "otherImmediateLocalResidentCorporateClaims" },
    { column: 15, name: "otherImmediateLocalResidentHouseholdClaims" },
    { column: 16, name: "otherImmediateLocalResidentTotalClaims" },
  ],
};
const indexDecoder = new TextDecoder("utf-8", { fatal: true });
const MONTH_BY_NAME: Readonly<Record<string, string>> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/** Parses the publisher's release table and discovers its irregular data links. */
export function parseFfiecE16Index(html: string): readonly FfiecE16ReleaseEntry[] {
  let matchingTable = "";
  for (const match of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const table = match[1] ?? "";
    const header = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(table)?.[1] ?? "";
    const headings = Array.from(header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi), (cell) =>
      cleanText(cell[1] ?? ""),
    );
    if (
      headings.length === 4 &&
      headings[0] === "Report Date" &&
      headings[1] === "Release Date" &&
      headings[2] === "Data File" &&
      headings[3] === "009a Data Report"
    ) {
      if (matchingTable) throw new Error("FFIEC E.16 index contains duplicate release tables");
      matchingTable = table;
    }
  }
  if (!matchingTable) throw new Error("FFIEC E.16 index is missing its release table");

  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(matchingTable)?.[1] ?? "";
  const entries: FfiecE16ReleaseEntry[] = [];
  const seenPeriods = new Set<string>();
  for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(
      (rowMatch[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),
      (cell) => cell[1] ?? "",
    );
    if (cells.length !== 4) throw new Error("FFIEC E.16 index has an incompatible release row");
    const reportLink = singleHtmlLink(cells[0] ?? "");
    const dataLink = singleHtmlLink(cells[2] ?? "");
    if (reportLink === undefined || dataLink === undefined) {
      throw new Error("FFIEC E.16 index has an incompatible release link");
    }
    const reportingPeriod = parsedIsoDate(reportLink.label);
    const releasedAt = parsedIsoDate(cleanText(cells[1] ?? ""));
    const url = absoluteE16DataUrl(dataLink.href);
    const format = url === undefined ? undefined : ffiecE16FormatFromUrl(url);
    if (
      reportingPeriod === undefined ||
      releasedAt === undefined ||
      url === undefined ||
      format === undefined ||
      !isQuarterEnd(reportingPeriod) ||
      seenPeriods.has(reportingPeriod)
    ) {
      throw new Error("FFIEC E.16 index has an incompatible release row");
    }
    const prior = entries.at(-1);
    if (prior !== undefined && prior.reportingPeriod <= reportingPeriod) {
      throw new Error("FFIEC E.16 index release periods are not newest-first");
    }
    seenPeriods.add(reportingPeriod);
    entries.push({ reportingPeriod, releasedAt, label: dataLink.label, url, format });
  }
  if (entries.length === 0) throw new Error("FFIEC E.16 index contains no releases");
  return entries;
}

/** Fetches and validates the authoritative E.16 release index. */
export async function listFfiecE16Releases(
  options: SourceFetchOptions = {},
): Promise<readonly FfiecE16ReleaseEntry[]> {
  const result = await fetchRaw(FFIEC_E16_INDEX_URL, options);
  try {
    return parseFfiecE16Index(indexDecoder.decode(result.bytes));
  } catch {
    throw new XnewsFetchError("network", "FFIEC E.16 index has an unexpected structure", {
      url: FFIEC_E16_INDEX_URL,
    });
  }
}

/** Parses one unwrapped E.16 workbook into the fifteen published data tables. */
export async function parseFfiecE16Workbook(
  workbookBytes: Uint8Array,
  options: FfiecE16ParseOptions = {},
): Promise<FfiecE16Workbook> {
  const limit = normalizeLimit(options.limit);
  const workbook = await readXlsx(workbookBytes, "FFIEC E.16 workbook");
  const cover = workbook.sheets[0];
  if (workbook.sheets.length !== 16 || cover?.name !== "E16_009") {
    throw new Error("FFIEC E.16 workbook has an unexpected sheet inventory");
  }
  const reportingPeriod = coverReportingPeriod(cover);
  if (reportingPeriod === undefined) {
    throw new Error("FFIEC E.16 workbook is missing its stated reporting period");
  }

  // E16_009 is the cover/notes sheet. The other fifteen sheets are data tables.
  // All Banks contains LFI and All Others, so the nested populations must not be summed.
  const seenDataSheets = new Set<string>();
  const rows: FfiecE16CountryExposureRow[] = [];
  for (const sheet of workbook.sheets.slice(1)) {
    const definition = sheetDefinition(sheet.name);
    if (definition === undefined || seenDataSheets.has(sheet.name)) {
      throw new Error("FFIEC E.16 workbook has an unexpected data sheet");
    }
    seenDataSheets.add(sheet.name);
    const title = sheet.rows.slice(0, 10).flat().find(isE16Title);
    const titlePeriod = title === undefined ? undefined : periodFromTitle(title);
    if (
      titlePeriod !== reportingPeriod ||
      title === undefined ||
      !title.includes(`Table ${definition.table}`) ||
      !title.includes(definition.populationLabel)
    ) {
      throw new Error(`FFIEC E.16 workbook has an incompatible title in ${sheet.name}`);
    }
    rows.push(...parseExposureSheet(sheet, definition, reportingPeriod));
  }
  if (seenDataSheets.size !== 15 || rows.length === 0) {
    throw new Error("FFIEC E.16 workbook has incomplete data tables");
  }

  return {
    reportingPeriod,
    sheetNames: workbook.sheets.map((sheet) => sheet.name),
    rows: limit === undefined ? rows : rows.slice(0, limit),
  };
}

/** Downloads either a bare XLSX or a ZIP-wrapped historical workbook. */
export async function fetchFfiecE16Release(
  entry: FfiecE16ReleaseEntry,
  options: SourceFetchOptions = {},
): Promise<FfiecE16Release> {
  validateReleaseEntry(entry);
  const result = await fetchRaw(entry.url, {
    ...options,
    maxResponseBytes: options.maxResponseBytes ?? FFIEC_E16_MAX_BYTES,
  });
  if (result.bytes[0] !== 0x50 || result.bytes[1] !== 0x4b || result.bytes[2] !== 0x03) {
    throw new XnewsFetchError("network", "FFIEC E.16 release did not return an archive", {
      url: entry.url,
    });
  }

  let parsed: FfiecE16Workbook;
  try {
    const workbookBytes = await unwrappedWorkbook(result.bytes, entry.format);
    parsed = await parseFfiecE16Workbook(
      workbookBytes,
      options.limit === undefined ? {} : { limit: options.limit },
    );
  } catch {
    throw new XnewsFetchError(
      "network",
      "FFIEC E.16 release has an unexpected workbook structure",
      {
        url: entry.url,
      },
    );
  }
  if (parsed.reportingPeriod !== entry.reportingPeriod) {
    throw new XnewsFetchError(
      "network",
      "FFIEC E.16 workbook period disagrees with the release index",
      { url: entry.url },
    );
  }

  return {
    provider: FFIEC_E16_PROVIDER_ID,
    dataset: "country-exposure",
    asOf: parsed.reportingPeriod,
    url: FFIEC_E16_INDEX_URL,
    rows: parsed.rows,
    entry,
    sheetNames: parsed.sheetNames,
  };
}

/** Uses the index as a cheap probe before downloading the latest workbook. */
export async function fetchFfiecE16Data(
  options: FfiecE16DataOptions = {},
): Promise<FfiecE16Release | undefined> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return undefined;
  validateIfNewerThan(options.ifNewerThan);
  const entries = await listFfiecE16Releases(options);
  const latest = entries[0];
  if (latest === undefined) return undefined;
  if (options.ifNewerThan !== undefined && latest.reportingPeriod <= options.ifNewerThan) {
    return undefined;
  }
  return fetchFfiecE16Release(latest, options);
}

/** Binds the latest quarterly E.16 release to the shared structured-data lane. */
export function ffiecE16DataSource(
  options: FfiecE16DataOptions = {},
): DataSource<FfiecE16CountryExposureRow> {
  return {
    provider: FFIEC_E16_PROVIDER_ID,
    dataset: "country-exposure",
    requestUrls: () => [FFIEC_E16_INDEX_URL],
    fetchRelease: (fetchOptions = {}) => fetchFfiecE16Data({ ...options, ...fetchOptions }),
  };
}

function parseExposureSheet(
  sheet: XlsxSheet,
  definition: SheetDefinition,
  reportingPeriod: string,
): readonly FfiecE16CountryExposureRow[] {
  const specs = TABLE_MEASURES[definition.table];
  const rows: FfiecE16CountryExposureRow[] = [];
  let pendingRegion: string | undefined;
  let sawData = false;

  for (const raw of sheet.rows) {
    const labelValue = raw[1];
    if (typeof labelValue !== "string" || !labelValue.trim()) continue;
    const countryOrRegion = labelValue.trim();
    const containsNumber = specs.some((spec) => {
      const value = raw[spec.column];
      return (
        typeof value === "number" ||
        (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
      );
    });
    if (!containsNumber) {
      pendingRegion = countryOrRegion;
      continue;
    }

    const warnings: string[] = [];
    const measures = specs.map((spec): FfiecE16ExposureMeasure => {
      const measureRaw = raw[spec.column];
      const value = numericMeasure(measureRaw);
      if (value === undefined) {
        warnings.push(`${spec.name} value ${JSON.stringify(measureRaw)} is not a finite number`);
        return { name: spec.name, raw: measureRaw };
      }
      return { name: spec.name, raw: measureRaw, value };
    });
    const rowKind: FfiecE16RowKind =
      countryOrRegion === "Grand Total"
        ? "grand-total"
        : countryOrRegion === "Total"
          ? "region-total"
          : "country-or-organization";
    const region =
      countryOrRegion === "UNITED STATES" || rowKind === "grand-total" ? undefined : pendingRegion;
    rows.push({
      reportingPeriod,
      population: definition.population,
      populationLabel: definition.populationLabel,
      table: definition.table,
      countryOrRegion,
      ...(region === undefined ? {} : { region }),
      rowKind,
      measures,
      raw,
      warnings,
    });
    sawData = true;
  }
  if (!sawData) throw new Error(`FFIEC E.16 sheet ${sheet.name} contains no exposure rows`);
  return rows;
}

function sheetDefinition(name: string): SheetDefinition | undefined {
  const match = /^(All Banks|LFI|All Others) - Table (1|2|3|4\.1|4\.2)$/.exec(name);
  const populationName = match?.[1];
  const table = match?.[2] ?? "";
  if (!isE16Table(table)) return undefined;
  if (populationName === "All Banks") {
    return { population: "all-banks", populationLabel: "All U.S. Banks - Group A", table };
  }
  if (populationName === "LFI") {
    return {
      population: "large-financial-institutions",
      populationLabel: "Large Financial Institutions (LFI) - Group B",
      table,
    };
  }
  if (populationName === "All Others") {
    return {
      population: "all-other-banks",
      populationLabel: "All Other U.S. Banks - Group C",
      table,
    };
  }
  return undefined;
}

function isE16Table(value: string): value is FfiecE16Table {
  return TABLE_VALUES.some((candidate) => candidate === value);
}

function isE16Title(value: XlsxCellValue): value is string {
  return typeof value === "string" && value.includes("Country Exposure Lending Survey");
}

function coverReportingPeriod(sheet: XlsxSheet): string | undefined {
  for (const cell of sheet.rows.flat()) {
    if (typeof cell !== "string") continue;
    const match = /Period:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(cell);
    const period = parsedIsoDate(match?.[1] ?? "");
    if (period !== undefined && isQuarterEnd(period)) return period;
  }
  return undefined;
}

function periodFromTitle(title: string): string | undefined {
  const match = /Country Exposure Lending Survey[^:]*:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(
    title,
  );
  const period = parsedIsoDate(match?.[1] ?? "");
  return period !== undefined && isQuarterEnd(period) ? period : undefined;
}

function numericMeasure(raw: XlsxCellValue): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function unwrappedWorkbook(
  payload: Uint8Array,
  format: FfiecE16ReleaseFormat,
): Promise<Uint8Array> {
  if (format === "xlsx") return payload;
  const entries = await readZipEntries(payload, "FFIEC E.16 release ZIP");
  const workbooks = entries.filter((entry) => entry.name.toLowerCase().endsWith(".xlsx"));
  if (workbooks.length !== 1 || workbooks[0] === undefined) {
    throw new Error("FFIEC E.16 release ZIP does not contain one XLSX workbook");
  }
  return workbooks[0].bytes;
}

function validateReleaseEntry(entry: FfiecE16ReleaseEntry): void {
  const url = absoluteE16DataUrl(entry.url);
  if (
    !isQuarterEnd(entry.reportingPeriod) ||
    parsedIsoDate(entry.reportingPeriod) !== entry.reportingPeriod ||
    parsedIsoDate(entry.releasedAt) !== entry.releasedAt ||
    url !== entry.url ||
    ffiecE16FormatFromUrl(entry.url) !== entry.format
  ) {
    throw new XnewsFetchError("config", "FFIEC E.16 release entry is invalid", {
      url: FFIEC_E16_INDEX_URL,
    });
  }
}

function validateIfNewerThan(value: string | undefined): void {
  if (value === undefined) return;
  const parsed = parsePublishedAt(value);
  if (parsed?.format !== "date_only" || parsed.instant.slice(0, 10) !== value) {
    throw new XnewsFetchError("config", "ifNewerThan must be an ISO date in YYYY-MM-DD form", {
      url: FFIEC_E16_INDEX_URL,
    });
  }
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new RangeError("limit must be a non-negative integer");
  return limit;
}

function isQuarterEnd(value: string): boolean {
  return /-(?:03-31|06-30|09-30|12-31)$/.test(value);
}

function parsedIsoDate(value: string): string | undefined {
  const text = value.trim();
  const namedDate = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(text);
  const month = MONTH_BY_NAME[(namedDate?.[1] ?? "").toLowerCase()];
  const normalized =
    namedDate === null || month === undefined
      ? text
      : `${namedDate[3]}-${month}-${(namedDate[2] ?? "").padStart(2, "0")}`;
  const parsed = parsePublishedAt(normalized);
  return parsed?.format === "date_only" ? parsed.instant.slice(0, 10) : undefined;
}

function absoluteE16DataUrl(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(decodeEntities(href), FFIEC_E16_INDEX_URL);
  } catch {
    return undefined;
  }
  return url.protocol === "https:" &&
    url.hostname === "www.ffiec.gov" &&
    url.pathname.startsWith(FFIEC_E16_DATA_PATH)
    ? url.toString()
    : undefined;
}

function singleHtmlLink(
  html: string,
): { readonly href: string; readonly label: string } | undefined {
  const links = Array.from(
    html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi),
  );
  if (links.length !== 1) return undefined;
  const href = decodeEntities(links[0]?.[2] ?? "").trim();
  const label = cleanText(links[0]?.[3] ?? "");
  return href && label ? { href, label } : undefined;
}
