import { normalizeLimit } from "../options.js";
import { socrataResourceUrl } from "./socrata.urls.js";

export const CDC_WASTEWATER_BASE_URL = "https://data.cdc.gov";
export const CDC_WASTEWATER_RESOURCE_ID = "2ew6-ywp6";
export const CDC_WASTEWATER_DATASET_URL = `${CDC_WASTEWATER_BASE_URL}/resource/${CDC_WASTEWATER_RESOURCE_ID}.json`;
export const CDC_WASTEWATER_DEFAULT_LIMIT = 5000;

export interface CdcWastewaterUrlOptions {
  readonly limit?: number;
  readonly appToken?: string;
}

/** Builds the newest-first NWSS query and aliases CDC's jurisdiction field to `state`. */
export function cdcWastewaterUrl(options: CdcWastewaterUrlOptions = {}): string {
  const limit = normalizeLimit(options.limit) ?? CDC_WASTEWATER_DEFAULT_LIMIT;
  return socrataResourceUrl(CDC_WASTEWATER_BASE_URL, CDC_WASTEWATER_RESOURCE_ID, {
    select: [
      "wwtp_jurisdiction AS state",
      "date_start",
      "date_end",
      "percentile",
      "ptc_15d",
      "detect_prop_15d",
    ],
    order: "date_end DESC",
    limit,
    ...(options.appToken !== undefined ? { appToken: options.appToken } : {}),
  });
}
