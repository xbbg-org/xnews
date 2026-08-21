/**
 * Historical anonymous English-Wikipedia edits attributed to US congressional
 * networks, generated from Wikimedia revision dumps by `jarib/anon-history`.
 *
 * The archive is deliberately modeled as historical. Wikimedia's temporary
 * accounts replaced public IP attribution for logged-out editors across the
 * production wikis in late 2025, so public RecentChanges/EventStreams data can
 * no longer support a truthful current CongressEdits detector.
 *
 * Archive: https://github.com/jarib/anon-history/tree/gh-pages/congressedits
 * Temporary accounts: https://www.mediawiki.org/wiki/Trust_and_Safety_Product/Temporary_Accounts
 */

export const WIKIPEDIA_CONGRESS_EDITS_ARCHIVE_BASE_URL =
  "https://jarib.github.io/anon-history/congressedits/en/latest";
export const WIKIPEDIA_CONGRESS_EDITS_DATA_URL = `${WIKIPEDIA_CONGRESS_EDITS_ARCHIVE_BASE_URL}/data.csv`;
export const WIKIPEDIA_CONGRESS_EDITS_RANGES_URL = `${WIKIPEDIA_CONGRESS_EDITS_ARCHIVE_BASE_URL}/ranges.json`;
export const WIKIPEDIA_CONGRESS_EDITS_PAGE_URL = `${WIKIPEDIA_CONGRESS_EDITS_ARCHIVE_BASE_URL}/`;

/** Coverage measured from the archive's 13,269 revision rows. */
export const WIKIPEDIA_CONGRESS_EDITS_COVERAGE_START = "2003-11-10";
export const WIKIPEDIA_CONGRESS_EDITS_COVERAGE_END = "2014-07-07";
export const WIKIPEDIA_CONGRESS_EDITS_ARCHIVE_ROW_COUNT = 13_269;
