import { normalizeLimit } from "../options.js";

export const GRANTS_GOV_SEARCH_URL = "https://api.grants.gov/v1/api/search2";
export const GRANTS_GOV_SEARCH_PAGE_URL = "https://www.grants.gov/search-results";
export const GRANTS_GOV_DETAIL_BASE_URL = "https://www.grants.gov/search-results-detail/";
export const GRANTS_GOV_DEFAULT_ROWS = 100;

export interface GrantsGovSearchBodyOptions {
  readonly rows?: number;
  readonly keyword?: string;
}

export interface GrantsGovSearchBody {
  readonly rows: number;
  readonly keyword: string;
  readonly oppStatuses: "posted";
}

export function grantsGovSearchBody(options: GrantsGovSearchBodyOptions = {}): GrantsGovSearchBody {
  return {
    rows: normalizeLimit(options.rows) ?? GRANTS_GOV_DEFAULT_ROWS,
    keyword: options.keyword ?? "",
    oppStatuses: "posted",
  };
}

export function grantsGovOpportunityUrl(id: string): string {
  return `${GRANTS_GOV_DETAIL_BASE_URL}${encodeURIComponent(id)}`;
}
