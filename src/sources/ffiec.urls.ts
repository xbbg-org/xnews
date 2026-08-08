/**
 * FFIEC CDR bulk data distribution: quarterly Call Report and UBPR bulk
 * files from https://cdr.ffiec.gov/public/pws/downloadbulkdata.aspx.
 *
 * The endpoint is a stateful ASP.NET page driven by postbacks: load the
 * page, select a product, select a reporting period, select a file format,
 * then submit the download button — every step POSTing the page's hidden
 * `__VIEWSTATE` fields and carrying the session cookies. This module holds
 * the network-free half of that contract: the endpoint, the product and
 * format registries, the postback form builders, and reporting-period
 * helpers. `sources/ffiec.ts` supplies the transport and parsers.
 */

export const FFIEC_CDR_BULK_DATA_URL = "https://cdr.ffiec.gov/public/pws/downloadbulkdata.aspx";

/** ASP.NET form field carrying the bulk product listbox selection. */
export const FFIEC_BULK_PRODUCT_FIELD = "ctl00$MainContentHolder$ListBox1";
/** ASP.NET form field carrying the reporting-period dropdown selection. */
export const FFIEC_BULK_PERIOD_FIELD = "ctl00$MainContentHolder$DatesDropDownList";
/** ASP.NET form field carrying the file-format radio selection. */
export const FFIEC_BULK_FORMAT_FIELD = "ctl00$MainContentHolder$FormatType";
/** ASP.NET submit field that triggers the download. */
export const FFIEC_BULK_DOWNLOAD_FIELD = "ctl00$MainContentHolder$TabStrip1$Download_0";

export type FfiecBulkProduct =
  | "call-single"
  | "call-four-period"
  | "ubpr-ratio-single"
  | "ubpr-ratio-four"
  | "ubpr-rank-four"
  | "ubpr-stats-four";

export type FfiecBulkFormat = "tsv" | "xbrl";

/** Which TSV bundle parser understands a product's download, when any does. */
export type FfiecBundleKind = "call" | "call-subset" | "ubpr";

export interface FfiecBulkProductDefinition {
  readonly product: FfiecBulkProduct;
  /** Value the product listbox posts back (also the CDR series name). */
  readonly formValue: string;
  /** Label the CDR page shows for this product. */
  readonly label: string;
  /** Supported file formats; the first is the CDR page's default. */
  readonly formats: readonly FfiecBulkFormat[];
  /** TSV bundle family `parseFfiec*Bundle` can parse, when TSV is offered. */
  readonly bundle?: FfiecBundleKind;
}

export const FFIEC_BULK_PRODUCTS: readonly FfiecBulkProductDefinition[] = [
  {
    product: "call-single",
    formValue: "ReportingSeriesSinglePeriod",
    label: "Call Reports -- Single Period",
    formats: ["xbrl", "tsv"],
    bundle: "call",
  },
  {
    product: "call-four-period",
    formValue: "ReportingSeriesSubsetSchedulesFourPeriods",
    label: "Call Reports -- Balance Sheet, Income Statement, Past Due -- Four Periods",
    formats: ["tsv"],
    bundle: "call-subset",
  },
  {
    product: "ubpr-ratio-single",
    formValue: "PerformanceReportingSeriesSinglePeriod",
    label: "UBPR Ratio -- Single Period",
    formats: ["xbrl"],
  },
  {
    product: "ubpr-ratio-four",
    formValue: "PerformanceReportingSeriesFourPeriods",
    label: "UBPR Ratio -- Four Periods",
    formats: ["tsv"],
    bundle: "ubpr",
  },
  {
    product: "ubpr-rank-four",
    formValue: "PerformanceReportingSeriesRank",
    label: "UBPR Rank -- Four Periods",
    formats: ["tsv"],
    bundle: "ubpr",
  },
  {
    product: "ubpr-stats-four",
    formValue: "PerformanceReportingSeriesStats",
    label: "UBPR Stats -- Four Periods",
    formats: ["tsv"],
    bundle: "ubpr",
  },
];

const FORMAT_FORM_VALUES: Record<FfiecBulkFormat, string> = {
  tsv: "TSVRadioButton",
  // The lowercase "b" is verbatim from the CDR page markup.
  xbrl: "XBRLRadiobutton",
};

/** Resolves a product id (or its CDR series form value) to its definition. */
export function ffiecBulkProductDefinition(product: FfiecBulkProduct): FfiecBulkProductDefinition {
  const definition = FFIEC_BULK_PRODUCTS.find(
    (entry) => entry.product === product || entry.formValue === product,
  );
  if (!definition) {
    const known = FFIEC_BULK_PRODUCTS.map((entry) => entry.product).join(", ");
    throw new RangeError(
      `Unknown FFIEC bulk product ${JSON.stringify(product)}; expected one of: ${known}`,
    );
  }
  return definition;
}

/** One option of the CDR reporting-period dropdown, verbatim. */
export interface FfiecReportingPeriod {
  /** Value the period dropdown posts back (an opaque index). */
  readonly formValue: string;
  /** Label the CDR page shows, normally `MM/DD/YYYY`; `YYYY` for UBPR bulk. */
  readonly label: string;
}

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** ISO `YYYY-MM-DD` for a period labeled `MM/DD/YYYY`, else `undefined`. */
export function ffiecReportingPeriodDate(period: FfiecReportingPeriod): string | undefined {
  const match = US_DATE.exec(period.label);
  if (!match) return undefined;
  const [, month = "", day = "", year = ""] = match;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    return undefined;
  }
  return iso;
}

/**
 * Whether a caller-supplied period query names this period. Accepted forms:
 * the dropdown form value, the verbatim label, `YYYYMMDD`, ISO
 * `YYYY-MM-DD`, and `M/D/YYYY` with or without zero padding.
 */
export function ffiecReportingPeriodMatches(period: FfiecReportingPeriod, query: string): boolean {
  const candidate = query.trim();
  if (candidate === period.formValue || candidate === period.label) return true;

  const iso = ffiecReportingPeriodDate(period);
  if (iso === undefined) return false;
  if (candidate === iso) return true;
  if (/^\d{8}$/.test(candidate)) {
    return candidate === iso.replaceAll("-", "");
  }
  const match = US_DATE.exec(candidate);
  if (!match) return false;
  const [, month = "", day = "", year = ""] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` === iso;
}

/** First period matching the query (see `ffiecReportingPeriodMatches`). */
export function findFfiecReportingPeriod(
  query: string,
  periods: readonly FfiecReportingPeriod[],
): FfiecReportingPeriod | undefined {
  return periods.find((period) => ffiecReportingPeriodMatches(period, query));
}

function postbackForm(
  hiddenFields: Readonly<Record<string, string>>,
  eventTarget: string,
  fields: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    ...hiddenFields,
    __EVENTTARGET: eventTarget,
    __EVENTARGUMENT: "",
    ...fields,
  };
}

/** Postback that selects a product, making its periods available. */
export function ffiecBulkProductSelectForm(
  hiddenFields: Readonly<Record<string, string>>,
  product: FfiecBulkProduct,
): Record<string, string> {
  const definition = ffiecBulkProductDefinition(product);
  return postbackForm(hiddenFields, FFIEC_BULK_PRODUCT_FIELD, {
    [FFIEC_BULK_PRODUCT_FIELD]: definition.formValue,
  });
}

/** Postback that selects a reporting period for a product. */
export function ffiecBulkPeriodSelectForm(
  hiddenFields: Readonly<Record<string, string>>,
  product: FfiecBulkProduct,
  periodFormValue: string,
): Record<string, string> {
  const definition = ffiecBulkProductDefinition(product);
  return postbackForm(hiddenFields, FFIEC_BULK_PERIOD_FIELD, {
    [FFIEC_BULK_PRODUCT_FIELD]: definition.formValue,
    [FFIEC_BULK_PERIOD_FIELD]: periodFormValue,
  });
}

/** Postback that selects a file format for a product and period. */
export function ffiecBulkFormatSelectForm(
  hiddenFields: Readonly<Record<string, string>>,
  product: FfiecBulkProduct,
  periodFormValue: string,
  format: FfiecBulkFormat,
): Record<string, string> {
  const definition = ffiecBulkProductDefinition(product);
  requireSupportedFormat(definition, format);
  return postbackForm(hiddenFields, `ctl00$MainContentHolder$${FORMAT_FORM_VALUES[format]}`, {
    [FFIEC_BULK_PRODUCT_FIELD]: definition.formValue,
    [FFIEC_BULK_PERIOD_FIELD]: periodFormValue,
    [FFIEC_BULK_FORMAT_FIELD]: FORMAT_FORM_VALUES[format],
  });
}

/** Final postback that submits the download button. */
export function ffiecBulkDownloadForm(
  hiddenFields: Readonly<Record<string, string>>,
  product: FfiecBulkProduct,
  periodFormValue: string,
  format: FfiecBulkFormat,
): Record<string, string> {
  const definition = ffiecBulkProductDefinition(product);
  requireSupportedFormat(definition, format);
  return postbackForm(hiddenFields, "", {
    [FFIEC_BULK_DOWNLOAD_FIELD]: "Download",
    [FFIEC_BULK_PRODUCT_FIELD]: definition.formValue,
    [FFIEC_BULK_PERIOD_FIELD]: periodFormValue,
    [FFIEC_BULK_FORMAT_FIELD]: FORMAT_FORM_VALUES[format],
  });
}

function requireSupportedFormat(
  definition: FfiecBulkProductDefinition,
  format: FfiecBulkFormat,
): void {
  if (!definition.formats.includes(format)) {
    throw new RangeError(
      `FFIEC bulk product ${definition.product} does not offer the ${format} format; ` +
        `available: ${definition.formats.join(", ")}`,
    );
  }
}
