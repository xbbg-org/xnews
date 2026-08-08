/**
 * DTCC Public Price Dissemination (PPD) — real-time swap transaction
 * dissemination from DTCC's swap data repositories, published free and
 * keyless at https://pddata.dtcc.com/ppd.
 *
 * Two shapes of data exist per (agency, asset class) pair:
 *  - intraday slices: ZIP-of-CSV files published continuously through the
 *    day, indexed by a JSON slice catalog covering the most recent days;
 *  - cumulative end-of-day files: one ZIP-of-CSV per business date with
 *    the full day, published in the evening US time and retained long-term.
 *
 * The slice catalog is served by the PPD API; slice and cumulative files
 * are served from DTCC's public data bucket. Every combination of agency
 * and asset class resolves through the same URL scheme (CFTC publishes all
 * five asset classes; SEC's security-based swap dissemination has been
 * verified for credits, equities, and rates).
 */

/** PPD API root serving the slice catalog. */
export const DTCC_PPD_API_BASE_URL = "https://pddata.dtcc.com/ppd/api";
/** Public data bucket serving slice and cumulative ZIP files. */
export const DTCC_DATA_BASE_URL = "https://kgc0418-tdw-data-0.s3.amazonaws.com";
/** Human-facing PPD site. */
export const DTCC_PPD_PAGE_URL = "https://pddata.dtcc.com/ppd";

export const DTCC_AGENCIES = ["cftc", "sec"] as const;
export type DtccAgency = (typeof DTCC_AGENCIES)[number];

export const DTCC_ASSET_CLASSES = ["credits", "rates", "equities", "forex", "commodities"] as const;
export type DtccAssetClass = (typeof DTCC_ASSET_CLASSES)[number];

/** Catalog path code per asset class (`/slice/CFTC/CR`). */
const ASSET_CLASS_CODES: Record<DtccAssetClass, string> = {
  credits: "CR",
  rates: "IR",
  equities: "EQ",
  forex: "FX",
  commodities: "CO",
};

/** File-name segment per asset class (`CFTC_SLICE_CREDITS_…`). */
const ASSET_CLASS_SEGMENTS: Record<DtccAssetClass, string> = {
  credits: "CREDITS",
  rates: "RATES",
  equities: "EQUITIES",
  forex: "FOREX",
  commodities: "COMMODITIES",
};

/** Inverse of `ASSET_CLASS_SEGMENTS`, for parsing file names. */
const SEGMENT_ASSET_CLASSES: Record<string, DtccAssetClass> = {
  CREDITS: "credits",
  RATES: "rates",
  EQUITIES: "equities",
  FOREX: "forex",
  COMMODITIES: "commodities",
};

/** One slice catalog row, as served by `dtccSliceCatalogUrl`. */
export interface DtccSliceCatalogEntry {
  /** Monotonic catalog-wide slice counter; later slices have greater IDs. */
  readonly sliceId: number;
  readonly fileName: string;
  /** Dissemination window covered by the slice. */
  readonly startTs: string;
  readonly endTs: string;
  readonly rowCount: number;
  /** Instant the slice was published. */
  readonly dissemDTM: string;
  /** Download URL for the slice ZIP. */
  readonly url: string;
}

export interface DtccUrlOptions {
  /** Overrides `DTCC_PPD_API_BASE_URL` (no trailing slash). */
  readonly ppdApiBaseUrl?: string;
  /** Overrides `DTCC_DATA_BASE_URL` (no trailing slash). */
  readonly dataBaseUrl?: string;
}

/** JSON catalog of the most recent intraday slices for one asset class. */
export function dtccSliceCatalogUrl(
  agency: DtccAgency,
  assetClass: DtccAssetClass,
  options: DtccUrlOptions = {},
): string {
  const base = (options.ppdApiBaseUrl ?? DTCC_PPD_API_BASE_URL).replace(/\/+$/, "");
  return `${base}/slice/${agency.toUpperCase()}/${ASSET_CLASS_CODES[assetClass]}`;
}

/** Download URL for one intraday slice ZIP named by the catalog. */
export function dtccSliceUrl(
  agency: DtccAgency,
  fileName: string,
  options: DtccUrlOptions = {},
): string {
  const base = (options.dataBaseUrl ?? DTCC_DATA_BASE_URL).replace(/\/+$/, "");
  return `${base}/${agency}/slices/${fileName}`;
}

/** File name of the cumulative end-of-day ZIP for one business date. */
export function dtccCumulativeFileName(
  agency: DtccAgency,
  assetClass: DtccAssetClass,
  businessDate: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) {
    throw new RangeError(`Invalid business date '${businessDate}'. Expected YYYY-MM-DD.`);
  }
  const segment = ASSET_CLASS_SEGMENTS[assetClass];
  return `${agency.toUpperCase()}_CUMULATIVE_${segment}_${match[1]}_${match[2]}_${match[3]}.zip`;
}

/** Download URL for the cumulative end-of-day ZIP for one business date. */
export function dtccCumulativeUrl(
  agency: DtccAgency,
  assetClass: DtccAssetClass,
  businessDate: string,
  options: DtccUrlOptions = {},
): string {
  const base = (options.dataBaseUrl ?? DTCC_DATA_BASE_URL).replace(/\/+$/, "");
  return `${base}/${agency}/eod/${dtccCumulativeFileName(agency, assetClass, businessDate)}`;
}

export interface DtccSliceFileNameInfo {
  readonly agency: DtccAgency;
  readonly assetClass: DtccAssetClass;
  /** ISO business date (`YYYY-MM-DD`) embedded in the file name. */
  readonly date: string;
  /** 1-based position of the slice within its business date. */
  readonly ordinal: number;
}

const SLICE_FILE_NAME = /^(CFTC|SEC)_SLICE_([A-Z]+)_(\d{4})_(\d{2})_(\d{2})_(\d+)\.zip$/;

/** Slice file-name prefix to agency, for parsing file names. */
const AGENCY_BY_PREFIX: Record<string, DtccAgency> = { CFTC: "cftc", SEC: "sec" };

/** Parses a slice file name (`CFTC_SLICE_CREDITS_2026_08_08_1.zip`). */
export function parseDtccSliceFileName(fileName: string): DtccSliceFileNameInfo | undefined {
  const match = SLICE_FILE_NAME.exec(fileName);
  if (!match) return undefined;
  const [, prefix, segment, year, month, day, ordinal] = match;
  if (prefix === undefined || segment === undefined || ordinal === undefined) return undefined;
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const agency = AGENCY_BY_PREFIX[prefix];
  const assetClass = SEGMENT_ASSET_CLASSES[segment];
  if (agency === undefined || assetClass === undefined) return undefined;
  return {
    agency,
    assetClass,
    date: `${year}-${month}-${day}`,
    ordinal: Number(ordinal),
  };
}
