import { parsePublishedAt } from "../dates.js";

export const FRY9_PROVIDER_ID = "ffiec-fry9";
export const FRY9_FINANCIAL_DATA_URL =
  "https://www.ffiec.gov/npw/FinancialReport/FinancialDataDownload";
export const FRY9_ARCHIVE_DOWNLOAD_URL =
  "https://www.ffiec.gov/npw/FinancialReport/ReturnBHCFZipFiles";
export const FRY9_DATA_DICTIONARY_URL =
  "https://www.ffiec.gov/npw/StaticData/DataDownload/Financial_Download_Dictionary.xlsx";
export const FRY9_FIRST_YEAR = 2000;

export const FRY9_REPORTS = [
  {
    report: "fry9c",
    formId: "FR Y-9C",
    label: "Consolidated Financial Statements for Holding Companies",
    filers: "All domestic holding companies",
    basis: "consolidated",
    cadence: "quarterly",
    lineItemFamily: "consolidated",
  },
  {
    report: "fry9lp",
    formId: "FR Y-9LP",
    label: "Parent Company Only Financial Statements for Large Holding Companies",
    filers: "All large domestic holding companies",
    basis: "unconsolidated parent only",
    cadence: "quarterly",
    lineItemFamily: "parent",
  },
  {
    report: "fry9sp",
    formId: "FR Y-9SP",
    label: "Parent Company Only Financial Statements for Small Holding Companies",
    filers: "All small domestic holding companies",
    basis: "unconsolidated parent",
    cadence: "semiannual",
    lineItemFamily: "small",
  },
] as const;

export type Fry9Report = (typeof FRY9_REPORTS)[number]["report"];
export type Fry9ReportDefinition = (typeof FRY9_REPORTS)[number];
export type Fry9Cadence = Fry9ReportDefinition["cadence"];
export type Fry9LineItemFamily = Fry9ReportDefinition["lineItemFamily"];

const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"] as const;
const SEMIANNUAL_ENDS = ["06-30", "12-31"] as const;
const ALL_PERIOD_REPORTS: readonly Fry9Report[] = ["fry9c", "fry9lp", "fry9sp"];
const QUARTERLY_REPORTS: readonly Fry9Report[] = ["fry9c", "fry9lp"];

/** Resolves a public report id to the form definition verified on the NPW page. */
export function fry9ReportDefinition(report: string): Fry9ReportDefinition {
  const definition = FRY9_REPORTS.find((candidate) => candidate.report === report);
  if (definition === undefined) {
    throw new RangeError(`Unknown FR Y-9 report: ${report}`);
  }
  return definition;
}

/** Builds the public catalog page URL, optionally selecting one archive year. */
export function fry9FinancialDataPageUrl(year?: number): string {
  if (year === undefined) return FRY9_FINANCIAL_DATA_URL;
  if (!Number.isInteger(year) || year < FRY9_FIRST_YEAR || year > 9999) {
    throw new RangeError(
      `FR Y-9 year must be an integer from ${FRY9_FIRST_YEAR} through 9999; received ${String(year)}`,
    );
  }
  const url = new URL(FRY9_FINANCIAL_DATA_URL);
  url.searchParams.set("selectedyear", String(year));
  return url.toString();
}

/** Normalizes a supported calendar-quarter end to ISO `YYYY-MM-DD`. */
export function fry9ReportingPeriod(value: string): string {
  const text = value.trim();
  const parsed = parsePublishedAt(text);
  const periodEnd = parsed?.format === "date_only" ? parsed.instant.slice(0, 10) : undefined;
  const year = periodEnd === undefined ? Number.NaN : Number(periodEnd.slice(0, 4));
  if (
    periodEnd === undefined ||
    periodEnd !== text ||
    !Number.isInteger(year) ||
    year < FRY9_FIRST_YEAR ||
    !QUARTER_ENDS.some((ending) => periodEnd.endsWith(ending))
  ) {
    throw new RangeError(
      `FR Y-9 period must be a calendar-quarter end on or after ${FRY9_FIRST_YEAR}-03-31; received ${JSON.stringify(value)}`,
    );
  }
  return periodEnd;
}

/** Reports expected in a combined quarterly BHCF archive. */
export function fry9PeriodReports(periodEnd: string): readonly Fry9Report[] {
  const normalized = fry9ReportingPeriod(periodEnd);
  return SEMIANNUAL_ENDS.some((ending) => normalized.endsWith(ending))
    ? ALL_PERIOD_REPORTS
    : QUARTERLY_REPORTS;
}

/** Validates that a report is filed for a reporting period. */
export function fry9ReportPeriod(report: string, periodEnd: string): string {
  const definition = fry9ReportDefinition(report);
  const normalized = fry9ReportingPeriod(periodEnd);
  if (
    definition.report === "fry9sp" &&
    !SEMIANNUAL_ENDS.some((ending) => normalized.endsWith(ending))
  ) {
    throw new RangeError(
      `${definition.formId} is unavailable for ${normalized}; the form is filed semiannually at June 30 and December 31`,
    );
  }
  return normalized;
}

/** Publisher filename for the combined holding-company archive. */
export function fry9ArchiveName(report: string, periodEnd: string): string {
  const normalized = fry9ReportPeriod(report, periodEnd);
  return `BHCF${normalized.replaceAll("-", "")}.ZIP`;
}

/** Direct keyless GET URL for one combined quarterly holding-company archive. */
export function fry9ArchiveUrl(report: string, periodEnd: string): string {
  const url = new URL(FRY9_ARCHIVE_DOWNLOAD_URL);
  url.searchParams.set("zipfilename", fry9ArchiveName(report, periodEnd));
  return url.toString();
}
