/**
 * FFIEC E.16 releases are discovered from the publisher's table because data
 * filenames change shape across quarters and their labels can disagree with
 * the linked file extension.
 */

export const FFIEC_E16_PROVIDER_ID = "ffiec-e16";
export const FFIEC_E16_INDEX_URL = "https://www.ffiec.gov/data/e16";
export const FFIEC_E16_DATA_PATH = "/sites/default/files/data/e16/";

export type FfiecE16ReleaseFormat = "xlsx" | "zip";

export interface FfiecE16ReleaseEntry {
  /** Reporting period stated in the index's Report Date column. */
  readonly reportingPeriod: string;
  readonly releasedAt: string;
  /** Publisher-supplied link text, which is not a reliable filename. */
  readonly label: string;
  readonly url: string;
  readonly format: FfiecE16ReleaseFormat;
}

/** Resolves the transport from the actual linked path rather than its irregular label. */
export function ffiecE16FormatFromUrl(url: string): FfiecE16ReleaseFormat | undefined {
  let pathname: string;
  try {
    pathname = new URL(url, FFIEC_E16_INDEX_URL).pathname.toLowerCase();
  } catch {
    return undefined;
  }
  if (pathname.endsWith(".xlsx")) return "xlsx";
  if (pathname.endsWith(".zip")) return "zip";
  return undefined;
}
