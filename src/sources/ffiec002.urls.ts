import { parsePublishedAt } from "../dates.js";
import { XnewsFetchError } from "../errors.js";

export const FFIEC_002_PROVIDER_ID = "ffiec-002";
export const FFIEC_002_REPORT_SERIES = "FFIEC002";
export const FFIEC_002_REPORT_CSV_URL =
  "https://www.ffiec.gov/npw/FinancialReport/ReturnFinancialReportCSV";
export const FFIEC_002_INSTITUTION_PROFILE_URL = "https://www.ffiec.gov/npw/Institution/Profile";

export type Ffiec002Date = string | Date;

export interface Ffiec002ReportParams {
  /** Federal Reserve National Information Center entity identifier. */
  readonly rssdId: number;
  /** Reporting date, normally a calendar-quarter end. */
  readonly reportingDate: Ffiec002Date;
}

/** Builds the public NPW institution-level FFIEC 002 CSV download URL. */
export function ffiec002ReportCsvUrl(params: Ffiec002ReportParams): string {
  const rssdId = requireRssdId(params.rssdId, FFIEC_002_REPORT_CSV_URL);
  const reportingDate = ffiec002ReportingDate(params.reportingDate);
  const url = new URL(FFIEC_002_REPORT_CSV_URL);
  url.searchParams.set("rpt", FFIEC_002_REPORT_SERIES);
  url.searchParams.set("id", String(rssdId));
  url.searchParams.set("dt", reportingDate.replaceAll("-", ""));
  return url.toString();
}

/** Builds the human-facing NPW profile that publishes an institution's available reports. */
export function ffiec002InstitutionProfileUrl(rssdId: number): string {
  const normalized = requireRssdId(rssdId, FFIEC_002_INSTITUTION_PROFILE_URL);
  return `${FFIEC_002_INSTITUTION_PROFILE_URL}/${normalized}`;
}

/** Normalizes a caller-supplied reporting date to an ISO calendar date. */
export function ffiec002ReportingDate(value: Ffiec002Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throwInvalidDate();
    return value.toISOString().slice(0, 10);
  }

  const text = value.trim();
  const parsed = parsePublishedAt(text);
  if (parsed?.format !== "date_only") throwInvalidDate();
  return parsed.instant.slice(0, 10);
}

function requireRssdId(value: number, url: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new XnewsFetchError("config", "FFIEC 002 rssdId must be a positive safe integer", {
      url,
    });
  }
  return value;
}

function throwInvalidDate(): never {
  throw new XnewsFetchError(
    "config",
    "FFIEC 002 reportingDate must be a valid ISO date (YYYY-MM-DD)",
    { url: FFIEC_002_REPORT_CSV_URL },
  );
}
