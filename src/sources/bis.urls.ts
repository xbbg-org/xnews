import type { SourceFetchOptions } from "../types.js";

export interface BisResearchFilters {
  readonly limit?: number;
  readonly institutions?: readonly string[];
  readonly query?: string;
}

export interface BisResearchHubOptions extends SourceFetchOptions {
  readonly institutions?: readonly string[];
  readonly query?: string;
}

const BIS_ORIGIN = "https://www.bis.org";

/** Complete BIS Working Papers document-list snapshot. */
export const BIS_WORKING_PAPERS_URL = `${BIS_ORIGIN}/api/document_lists/wppubls.json`;

/** Complete Central Bank Research Hub paper snapshot. */
export const BIS_RESEARCH_HUB_URL = `${BIS_ORIGIN}/api/reshub_papers.json`;

/** Recent Central Bank Research Hub additions in RSS 1.0 format. */
export const BIS_RESEARCH_HUB_RSS_URL = `${BIS_ORIGIN}/doclist/reshub_papers.rss`;

export function bisWorkingPaperLandingUrl(path: string): string | undefined {
  const normalizedPath = normalizeWorkingPaperPath(path);
  return normalizedPath === undefined ? undefined : `${BIS_ORIGIN}${normalizedPath}.htm`;
}

export function bisWorkingPaperPdfUrl(path: string): string | undefined {
  const normalizedPath = normalizeWorkingPaperPath(path);
  return normalizedPath === undefined ? undefined : `${BIS_ORIGIN}${normalizedPath}.pdf`;
}

function normalizeWorkingPaperPath(path: string): string | undefined {
  const normalized = path.trim().replace(/\.(?:htm|pdf)$/i, "");
  return /^\/publ\/work\d+$/i.test(normalized) ? normalized : undefined;
}
