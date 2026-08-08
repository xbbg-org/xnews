/**
 * Structurally network-free view of xnews: URL builders, the fixed-feed
 * registry, provider operating policies, and the publication-date parser.
 *
 * The import graph of this module never reaches `src/http.ts` or any module
 * that fetches, so `import "@xbbg/xnews/catalog"` cannot execute network code
 * even in principle. Consumers with their own governed transport (SSRF
 * pinning, robots, rate limits) use this entrypoint for xnews's endpoint
 * knowledge while keeping retrieval entirely on their side.
 * `test/architecture.test.ts` enforces the graph property.
 */

import type { NewsProvider, WorksProvider } from "./types.js";

export { PUBLISHED_AT_PARSER_VERSION, parsePublishedAt } from "./dates.js";
export type { ParsedPublishedAt, PublishedAtFormat } from "./dates.js";
export { NEWS_ITEM_ID_SCHEME_VERSION } from "./text.js";
export type {
  NewsKind,
  NewsProvider,
  NewsProviderCapability,
  ProviderErrorCode,
  WorkAvailability,
  WorkIdentityOrigin,
  WorksProvider,
} from "./types.js";

export { alphaVantageTranscriptUrl } from "./sources/alphavantage.urls.js";
export type { AlphaVantageTranscriptOptions } from "./sources/alphavantage.urls.js";
export {
  annasArchiveMirrorBase,
  annasArchiveRecordUrl,
  annasArchiveSearchUrl,
  ANNAS_ARCHIVE_DEFAULT_PER_PAGE,
  ANNAS_ARCHIVE_MD5_PATH,
  ANNAS_ARCHIVE_SEARCH_PATH,
} from "./sources/annasarchive.urls.js";
export type {
  AnnasArchiveMirrorOptions,
  AnnasArchiveSearchUrlOptions,
} from "./sources/annasarchive.urls.js";
export {
  ARXIV_MIN_REQUEST_INTERVAL_MS,
  arxivCategoryFeedUrl,
  arxivSearchUrl,
} from "./sources/arxiv.urls.js";
export type {
  ArxivAnnouncementOptions,
  ArxivCategories,
  ArxivCategoryFeedFormat,
  ArxivSearchOptions,
  ArxivSearchSortBy,
  ArxivSearchSortOrder,
  ArxivSearchUrlOptions,
} from "./sources/arxiv.urls.js";
export { bingNewsRssUrl } from "./sources/bing.urls.js";
export { BIORXIV_API_ORIGIN, bioRxivDetailsUrl } from "./sources/biorxiv.urls.js";
export type { BioRxivDetailsUrlOptions, BioRxivServer } from "./sources/biorxiv.urls.js";
export {
  BIS_RESEARCH_HUB_RSS_URL,
  BIS_RESEARCH_HUB_URL,
  BIS_WORKING_PAPERS_URL,
  bisWorkingPaperLandingUrl,
  bisWorkingPaperPdfUrl,
} from "./sources/bis.urls.js";
export type { BisResearchFilters, BisResearchHubOptions } from "./sources/bis.urls.js";
export { courtListenerSearchUrl } from "./sources/courtlistener.urls.js";
export {
  COT_DATASETS,
  COT_DEFAULT_ROW_LIMIT,
  COT_FAMILY_COLUMNS,
  COT_IDENTITY_COLUMNS,
  COT_MARKETS,
  COT_MAX_ROW_LIMIT,
  cotDatasetDefinition,
  cotDatasetPageUrl,
  cotLatestDateUrl,
  cotMarketPreset,
  cotReportUrl,
  resolveCotMarketCodes,
} from "./sources/cot.urls.js";
export type {
  CotCategoryColumns,
  CotDataset,
  CotDatasetDefinition,
  CotFamilyColumns,
  CotMarketPreset,
  CotReportFamily,
  CotReportUrlOptions,
} from "./sources/cot.urls.js";
export {
  CROSSREF_INITIAL_CURSOR,
  CROSSREF_MAX_OFFSET,
  CROSSREF_MAX_ROWS,
  CROSSREF_WORKS_URL,
  crossrefWorksUrl,
} from "./sources/crossref.urls.js";
export type { CrossrefFilterValue, CrossrefWorksUrlOptions } from "./sources/crossref.urls.js";
export {
  DTCC_AGENCIES,
  DTCC_ASSET_CLASSES,
  DTCC_DATA_BASE_URL,
  DTCC_PPD_API_BASE_URL,
  DTCC_PPD_PAGE_URL,
  dtccCumulativeFileName,
  dtccCumulativeUrl,
  dtccSliceCatalogUrl,
  dtccSliceUrl,
  parseDtccSliceFileName,
} from "./sources/dtcc.urls.js";
export type {
  DtccAgency,
  DtccAssetClass,
  DtccSliceCatalogEntry,
  DtccSliceFileNameInfo,
  DtccUrlOptions,
} from "./sources/dtcc.urls.js";
export { EUROPE_PMC_SEARCH_URL, europePmcSearchUrl } from "./sources/europepmc.urls.js";
export type {
  EuropePmcSearchOptions,
  EuropePmcSearchUrlOptions,
} from "./sources/europepmc.urls.js";
export {
  FFIEC_BULK_DOWNLOAD_FIELD,
  FFIEC_BULK_FORMAT_FIELD,
  FFIEC_BULK_PERIOD_FIELD,
  FFIEC_BULK_PRODUCT_FIELD,
  FFIEC_BULK_PRODUCTS,
  FFIEC_CDR_BULK_DATA_URL,
  ffiecBulkDownloadForm,
  ffiecBulkFormatSelectForm,
  ffiecBulkPeriodSelectForm,
  ffiecBulkProductDefinition,
  ffiecBulkProductSelectForm,
  ffiecReportingPeriodDate,
  ffiecReportingPeriodMatches,
  findFfiecReportingPeriod,
} from "./sources/ffiec.urls.js";
export type {
  FfiecBulkFormat,
  FfiecBulkProduct,
  FfiecBulkProductDefinition,
  FfiecBundleKind,
  FfiecReportingPeriod,
} from "./sources/ffiec.urls.js";
export { federalRegisterSearchUrl } from "./sources/federalregister.urls.js";
export { finvizQuoteUrl } from "./sources/finviz.urls.js";
export {
  CENTRAL_BANK_NEWS_PROVIDERS,
  CENTRAL_BANK_RESEARCH_PROVIDERS,
  FIXED_FEEDS,
  FIXED_FEED_PROVIDERS,
  isFixedFeedProvider,
} from "./sources/fixedfeeds.urls.js";
export {
  fredSeriesObservationsUrl,
  fredSeriesSearchUrl,
  fredSeriesUrl,
} from "./sources/fred.urls.js";
export type {
  FredAggregationMethod,
  FredDate,
  FredDataSourceOptions,
  FredFrequency,
  FredObservationsOptions,
  FredRequestOptions,
  FredSeriesFilterVariable,
  FredSeriesOptions,
  FredSeriesSearchOptions,
  FredSeriesSearchOrderBy,
  FredSeriesSearchType,
  FredSortOrder,
  FredUnits,
} from "./sources/fred.urls.js";
export type { FixedFeedDefinition, FixedFeedProvider } from "./sources/fixedfeeds.urls.js";
export { gdeltDocUrl } from "./sources/gdelt.urls.js";
export { googleNewsRssUrl } from "./sources/google.urls.js";
export { hackerNewsSearchUrl } from "./sources/hackernews.urls.js";
export { HF_DAILY_PAPERS_URL, hfDailyPapersUrl } from "./sources/hfpapers.urls.js";
export type { HfDailyPapersUrlOptions } from "./sources/hfpapers.urls.js";
export {
  earningsTranscriptsFilterUrl,
  HF_EARNINGS_TRANSCRIPTS_DATASET,
  HF_MAX_PAGE_LENGTH,
  hfDatasetFilterUrl,
  hfDatasetRowsUrl,
  hfDatasetSearchUrl,
  hfDatasetViewerUrl,
} from "./sources/hftranscripts.urls.js";
export type {
  EarningsTranscriptQueryOptions,
  HfDatasetRef,
  HfRowsOptions,
} from "./sources/hftranscripts.urls.js";
export {
  internetArchiveRecordUrl,
  internetArchiveSearchUrl,
  INTERNET_ARCHIVE_BASE_URL,
  INTERNET_ARCHIVE_DEFAULT_ROWS,
  INTERNET_ARCHIVE_MAX_ROWS,
  INTERNET_ARCHIVE_SEARCH_FIELDS,
} from "./sources/internetarchive.urls.js";
export type { InternetArchiveSearchOptions } from "./sources/internetarchive.urls.js";
export {
  libgenAbsoluteUrl,
  libgenDetailUrl,
  libgenMirrorBase,
  libgenSearchUrl,
  LIBGEN_DEFAULT_PER_PAGE,
  LIBGEN_FICTION_PATH,
  LIBGEN_FILE_PATH,
  LIBGEN_INDEX_PATH,
  LIBGEN_MAX_PER_PAGE,
  LIBGEN_MIN_QUERY_LENGTH,
  LIBGEN_SCIMAG_PATH,
  LIBGEN_SEARCH_PATH,
} from "./sources/libgen.urls.js";
export type {
  LibgenLayout,
  LibgenMirrorOptions,
  LibgenSearchField,
  LibgenSearchUrlOptions,
  LibgenSortBy,
  LibgenSortOrder,
  LibgenTopic,
} from "./sources/libgen.urls.js";
export { msrbEmmaCdUrl, msrbEmmaPeriods } from "./sources/msrbemma.urls.js";
export type { MsrbEmmaPeriod } from "./sources/msrbemma.urls.js";
export { nasdaqRssUrl } from "./sources/nasdaq.urls.js";
export { NBER_RSS_URL, nberListingUrl } from "./sources/nber.urls.js";
export type { NberListingUrlOptions } from "./sources/nber.urls.js";
export {
  OPENALEX_DEFAULT_PER_PAGE,
  OPENALEX_INITIAL_CURSOR,
  OPENALEX_MAX_PER_PAGE,
  OPENALEX_MAX_REQUESTS_PER_SECOND,
  openAlexWorksUrl,
} from "./sources/openalex.urls.js";
export type { OpenAlexFilterValue, OpenAlexWorksOptions } from "./sources/openalex.urls.js";
export {
  openLibraryRecordUrl,
  openLibrarySearchUrl,
  OPEN_LIBRARY_BASE_URL,
  OPEN_LIBRARY_DEFAULT_LIMIT,
  OPEN_LIBRARY_MAX_LIMIT,
  OPEN_LIBRARY_SEARCH_FIELDS,
  OPEN_LIBRARY_USER_AGENT,
} from "./sources/openlibrary.urls.js";
export type { OpenLibrarySearchOptions } from "./sources/openlibrary.urls.js";
export { OSF_PREPRINTS_URL, osfPreprintsUrl } from "./sources/osf.urls.js";
export type { OsfPreprintsOptions, OsfPreprintsUrlOptions } from "./sources/osf.urls.js";
export { secCompanyAtomUrl } from "./sources/sec.urls.js";
export { secCurrentAtomUrl } from "./sources/seccurrent.urls.js";
export { SEC_COMMENTARY_QUERIES, secFullTextSearchUrl } from "./sources/secfulltext.urls.js";
export type { SecCommentaryQuery } from "./sources/secfulltext.urls.js";
export { seekingAlphaRssUrl } from "./sources/seekingalpha.urls.js";
export { SSRN_NETWORKS, resolveSsrnBindingId, ssrnPapersUrl } from "./sources/ssrn.urls.js";
export type { SsrnNetwork, SsrnPapersUrlOptions } from "./sources/ssrn.urls.js";
export { tickerTickFeedUrl } from "./sources/tickertick.urls.js";
export { WORLD_BANK_DOCUMENTS_API_URL, worldBankDocumentsUrl } from "./sources/worldbank.urls.js";
export type { WorldBankDocumentsUrlOptions } from "./sources/worldbank.urls.js";
export { yahooFinanceRssUrl } from "./sources/yahoo.urls.js";
export { yahooSearchUrl } from "./sources/yahoosearch.urls.js";
export {
  COMPANY_COMMENTARY_YOUTUBE_CHANNELS,
  youtubeChannelFeedUrl,
} from "./sources/youtube.urls.js";
export type { CommentaryChannelDefinition } from "./sources/youtube.urls.js";
export { youtubeWatchUrl } from "./sources/youtubetranscript.urls.js";
export {
  NIC_BULK_PRODUCTS,
  NIC_DATA_DICTIONARY_URL,
  NIC_DATA_DOWNLOAD_URL,
  NIC_REFRESH_FAQ_URL,
  nicBulkDownloadUrl,
  nicBulkProductDefinition,
} from "./sources/nic.urls.js";
export type {
  NicBulkProduct,
  NicBulkProductDefinition,
  NicBulkRecordKind,
} from "./sources/nic.urls.js";
export {
  FFIEC_002_INSTITUTION_PROFILE_URL,
  FFIEC_002_PROVIDER_ID,
  FFIEC_002_REPORT_CSV_URL,
  FFIEC_002_REPORT_SERIES,
  ffiec002InstitutionProfileUrl,
  ffiec002ReportingDate,
  ffiec002ReportCsvUrl,
} from "./sources/ffiec002.urls.js";
export type { Ffiec002Date, Ffiec002ReportParams } from "./sources/ffiec002.urls.js";
export {
  CRA_DATA_PRODUCTS_URL,
  CRA_DISCLAIMER_URL,
  CRA_FLAT_FILE_KINDS,
  CRA_FLAT_FILE_YEARS,
  CRA_FLAT_FILES_PAGE_URL,
  craFlatFileDefinition,
  craFlatFileSpecsUrl,
  craFlatFileUrl,
} from "./sources/cra.urls.js";
export type { CraFlatFileDefinition, CraFlatFileKind } from "./sources/cra.urls.js";
export {
  HMDA_AGGREGATION_DIMENSIONS,
  HMDA_DATA_BROWSER_API_BASE_URL,
  HMDA_DATA_BROWSER_API_DOCUMENTATION_URL,
  HMDA_DATA_BROWSER_URL,
  HMDA_MODIFIED_LAR_DOCUMENTATION_URL,
  hmdaAggregationsUrl,
  hmdaCountUrl,
  hmdaCsvUrl,
  hmdaFilersUrl,
  hmdaNationwideAggregationsUrl,
  hmdaNationwideCsvUrl,
  hmdaNationwidePipeUrl,
  hmdaPipeUrl,
} from "./sources/hmda.urls.js";
export type {
  HmdaActionTaken,
  HmdaAggregationDimension,
  HmdaApplicantAge,
  HmdaConstructionMethod,
  HmdaCountQuery,
  HmdaDimensionFilters,
  HmdaDwellingCategory,
  HmdaEthnicity,
  HmdaFilerQuery,
  HmdaFilterList,
  HmdaFilterSet,
  HmdaGeographyFilters,
  HmdaLienStatus,
  HmdaLoanProduct,
  HmdaLoanPurpose,
  HmdaLoanType,
  HmdaNationwideQuery,
  HmdaQuery,
  HmdaRace,
  HmdaSex,
  HmdaTotalUnits,
  HmdaYear,
  HmdaYearFilter,
} from "./sources/hmda.urls.js";
export {
  FFIEC_CENSUS_ARCHIVES,
  FFIEC_CENSUS_DICTIONARIES,
  FFIEC_CENSUS_FLAT_FILES_URL,
  FFIEC_CENSUS_YEARS,
  FFIEC_GEOCODE_OUT_FIELDS,
  FFIEC_GEOMAP_SERVICES_URL,
  FFIEC_GEOMAP_URL,
  ffiecCensusArchiveUrl,
  ffiecCensusDictionaryUrl,
  ffiecCensusPeriodEnd,
  ffiecGeocodeCandidateUrl,
  ffiecGeocodeTractUrl,
  isFfiecCensusYear,
} from "./sources/ffieccensus.urls.js";
export type {
  FfiecCensusYear,
  FfiecGeocodePoint,
  FfiecGeocodeServiceBinding,
} from "./sources/ffieccensus.urls.js";
export {
  FRY9_ARCHIVE_DOWNLOAD_URL,
  FRY9_DATA_DICTIONARY_URL,
  FRY9_FINANCIAL_DATA_URL,
  FRY9_FIRST_YEAR,
  FRY9_PROVIDER_ID,
  FRY9_REPORTS,
  fry9ArchiveName,
  fry9ArchiveUrl,
  fry9FinancialDataPageUrl,
  fry9PeriodReports,
  fry9ReportDefinition,
  fry9ReportingPeriod,
  fry9ReportPeriod,
} from "./sources/fry9.urls.js";
export type {
  Fry9Cadence,
  Fry9LineItemFamily,
  Fry9Report,
  Fry9ReportDefinition,
} from "./sources/fry9.urls.js";

export {
  FFIEC_E16_DATA_PATH,
  FFIEC_E16_INDEX_URL,
  FFIEC_E16_PROVIDER_ID,
  ffiecE16FormatFromUrl,
} from "./sources/ffiece16.urls.js";
export type { FfiecE16ReleaseEntry, FfiecE16ReleaseFormat } from "./sources/ffiece16.urls.js";

/**
 * Operational facts a consumer needs before pointing a scheduler at a
 * provider. Only documented, verifiable requirements are recorded here;
 * absence of an entry means "no special requirement is known", not "no
 * limit exists".
 */
export interface ProviderPolicy {
  /** Documented provider-wide request rate ceiling. */
  readonly maxRequestsPerSecond?: number;
  /** Documented minimum delay between consecutive requests. */
  readonly minRequestIntervalMs?: number;
  /** Provider rejects or throttles clients without a declared User-Agent. */
  readonly requiresDeclaredUserAgent?: boolean;
  /** Provider requires an API key before retrieval. */
  readonly requiresApiKey?: boolean;
  /** URL of terms the caller must accept before the provider serves data. */
  readonly requiresTermsAcceptance?: string;
  /** Provider terms relevant to use of the retrieved content or API. */
  readonly termsUrl?: string;
  readonly notes?: string;
}

const SEC_POLICY: ProviderPolicy = {
  maxRequestsPerSecond: 10,
  requiresDeclaredUserAgent: true,
  notes:
    "SEC fair-access policy: declare a User-Agent with contact information (set secUserAgent) and stay at or under 10 requests per second across all sec.gov endpoints combined.",
};

export const ARXIV_PROVIDER_POLICY: ProviderPolicy = {
  minRequestIntervalMs: 3_000,
  notes:
    "arXiv asks legacy API clients making consecutive calls to leave at least three seconds between requests. Adapter availability does not grant a license to redistribute paper content.",
};

export const OPENALEX_PROVIDER_POLICY: ProviderPolicy = {
  maxRequestsPerSecond: 100,
  requiresApiKey: true,
  notes:
    "OpenAlex requires an API key. Requests consume the key's operation-dependent daily budget, while response rate-limit headers are authoritative for short-term scheduling.",
};

export const BIS_PROVIDER_POLICY: ProviderPolicy = {
  termsUrl: "https://www.bis.org/terms_conditions.htm",
  notes:
    "Review BIS terms and obtain permission where required before reproducing or redistributing content. Adapter availability is endpoint access, not a content-redistribution license.",
};

export const FRED_PROVIDER_POLICY: ProviderPolicy = {
  maxRequestsPerSecond: 2,
  requiresApiKey: true,
  termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html",
  notes:
    "FRED limits API traffic to 120 requests per minute and requires compliance with its API terms. A FRED API key identifies the caller but does not replace source-specific attribution or use restrictions.",
};

export const NBER_PROVIDER_POLICY: ProviderPolicy = {
  notes:
    "The JSON listing is nber.org's own site search API — undocumented and subject to change; the RSS feed is the stable official surface. Metadata and abstracts link to NBER landing pages; the papers themselves are not generally redistributable.",
};

export const SSRN_PROVIDER_POLICY: ProviderPolicy = {
  notes:
    "Unofficial, undocumented Elsevier endpoint behind papers.ssrn.com browsing; it may change or be restricted without notice. Listings return metadata without abstracts. Landing pages and PDFs remain governed by SSRN terms; is_paid records are metadata-only pointers.",
};

export const CROSSREF_PROVIDER_POLICY: ProviderPolicy = {
  notes:
    "Free public REST API. Set mailto to join the polite pool and honor the X-Rate-Limit response headers. Bibliographic metadata is openly reusable, but abstracts are publisher-supplied and may carry publisher rights.",
};

export const WORLD_BANK_PROVIDER_POLICY: ProviderPolicy = {
  notes:
    "Free, keyless Documents & Reports (WDS) API. Most World Bank publications are CC BY 4.0, but each record's own license statement is authoritative; attribute the World Bank when reproducing content.",
};

export const BIORXIV_PROVIDER_POLICY: ProviderPolicy = {
  notes:
    "Free, keyless details API shared by bioRxiv and medRxiv; responses page 100 records per cursor and the endpoint can take tens of seconds to answer. Preprint licenses vary per record; only the metadata is CC0.",
};

export const EUROPE_PMC_PROVIDER_POLICY: ProviderPolicy = {
  termsUrl: "https://europepmc.org/Copyright",
  notes:
    "Free REST API with cursorMark paging. EBI asks bulk users to keep request rates modest; abstracts and full texts carry per-record licenses.",
};

export const HF_PAPERS_PROVIDER_POLICY: ProviderPolicy = {
  notes:
    "Undocumented but widely used huggingface.co endpoint listing community-curated daily arXiv papers; availability and response shape may change without notice.",
};

export const OSF_PROVIDER_POLICY: ProviderPolicy = {
  notes:
    "OSF JSON:API v2. Unauthenticated traffic is throttled; pages cap at 100 records. Preprint licenses vary per provider and per record.",
};

export const NIC_PROVIDER_POLICY: ProviderPolicy = {
  requiresApiKey: false,
  termsUrl: "https://www.federalreserve.gov/disclaimer.htm",
  notes:
    "NIC says Structure Data Download is refreshed daily and describes the snapshots as non-confidential public data, without stating a redistribution license. The five keyless direct-GET CSV ZIPs require neither an ASP.NET postback nor a caller-managed session cookie and currently span about 0.6-14 MiB; xnews allows 64 MiB. No numeric request-rate ceiling is documented. The page's last-update date is the snapshot as-of date; Attributes #ID_RSSD and Relationships parent/offspring RSSD IDs join to FFIEC Call Reports' IDRSSD.",
};
export const FFIEC_002_PROVIDER_POLICY: ProviderPolicy = {
  requiresApiKey: false,
  termsUrl: "https://www.federalreserve.gov/disclaimer.htm",
  notes:
    "NPW publishes keyless institution-level FFIEC 002 CSVs, one RSSD ID and reporting quarter per request; it does not offer a bulk 002 archive. Board information is public domain unless indicated otherwise, should cite the Board, and is supplied without warranty. No numeric request-rate ceiling is documented.",
};
export const CRA_PROVIDER_POLICY: ProviderPolicy = {
  requiresApiKey: false,
  termsUrl: "https://www.ffiec.gov/disclaimer",
  notes:
    "FFIEC says CRA data are generally released annually by August following the activity year, with annual prior-year resubmission files beginning in February 2026. The original 2024 ZIPs were 33,707 bytes (transmittal), 5,610,753 bytes (aggregate), and 22,816,732 bytes (disclosure). Aggregate and disclosure flat files reproduce derived report tables, not loan-level records. The CRA product and flat-file pages document no numeric request-rate ceiling.",
};
export const HMDA_PROVIDER_POLICY: ProviderPolicy = {
  requiresApiKey: false,
  requiresDeclaredUserAgent: true,
  notes:
    "Free, keyless HMDA Data Browser API. Its documentation states no numeric request-rate ceiling or API-specific terms; schedule conservatively because exports can be very large. The CFPB edge rejects xnews's bot-shaped default User-Agent, so this adapter uses a browser-shaped default. Public loan-level exports are the modified LAR: CFPB documents 27 fields redacted and 6 fields modified for applicant and borrower privacy.",
};

export const FFIEC_CENSUS_PROVIDER_POLICY: ProviderPolicy = {
  requiresApiKey: false,
  requiresDeclaredUserAgent: true,
  termsUrl: "https://www.ffiec.gov/disclaimer",
  notes:
    "FFIEC publishes the census flat file annually for use with the matching HMDA/CRA activity year; the census year identifies that year's geography and income denominator, so substituting a stale file changes tract classifications and denominators. The 2026 ZIP was 95,033,841 bytes and inflated to a 301,371,095-byte, 1,212-field CSV. The archive and geomap rejected xnews's bot-shaped default User-Agent during live probes, so this adapter uses a browser-shaped default. Geomap derives a public ArcGIS token from its service manifest rather than requiring a caller key. FFIEC documents no numeric request-rate ceiling.",
};
export const FRY9_PROVIDER_POLICY: ProviderPolicy = {
  requiresApiKey: false,
  termsUrl: "https://www.federalreserve.gov/disclaimer.htm",
  notes:
    "NPW publishes keyless combined quarterly BHCF ZIPs by direct GET and refreshes them around 05:00 EST each weekday. FR Y-9C and Y-9LP are quarterly; FR Y-9SP is semiannual. The page warns that filings may remain incomplete or change until the 45-calendar-day Y-9 deadline. Live 2025-09-30 and 2025-12-31 probes found 664,462-byte and 1,472,610-byte ZIPs expanding to 2,455,902 and 11,226,479 bytes. FR Y-9C is consolidated while FR Y-9LP is parent-only; they are different accounting scopes and must not be summed. No API key, session cookie, authentication, or numeric request-rate ceiling is documented, but ffiec.gov's edge answers a first cold request with an HTML block page under HTTP 403 and then serves subsequent requests, so treat an isolated 403 as retryable rather than as a missing credential.",
};

export const FFIEC_E16_PROVIDER_POLICY: ProviderPolicy = {
  requiresApiKey: false,
  termsUrl: "https://www.ffiec.gov/disclaimer",
  notes:
    "FFIEC publishes the keyless E.16 country-exposure release quarterly from aggregated FFIEC 009 filings. It is a cleansed population-level product, not filer-level data: All Banks contains the LFI and All Others populations, so those groups must not be summed. The verified 2026-03-31 bare XLSX was 202,996 bytes; the 2024-12-31 ZIP wrapper was 175,217 bytes and contained one roughly 181 KiB XLSX. Filenames and link labels are irregular, so consumers must discover links from the index and use the workbook's stated period.",
};

export const PROVIDER_POLICIES: Partial<Record<NewsProvider, ProviderPolicy>> = {
  "sec-edgar": SEC_POLICY,
  "sec-fulltext": SEC_POLICY,
  "sec-current": SEC_POLICY,
  "sec-press": SEC_POLICY,
  arxiv: ARXIV_PROVIDER_POLICY,
  openalex: OPENALEX_PROVIDER_POLICY,
  "bis-research": BIS_PROVIDER_POLICY,
  "bis-research-hub": BIS_PROVIDER_POLICY,
  nber: NBER_PROVIDER_POLICY,
  ssrn: SSRN_PROVIDER_POLICY,
  crossref: CROSSREF_PROVIDER_POLICY,
  "world-bank": WORLD_BANK_PROVIDER_POLICY,
  biorxiv: BIORXIV_PROVIDER_POLICY,
  medrxiv: BIORXIV_PROVIDER_POLICY,
  "europe-pmc": EUROPE_PMC_PROVIDER_POLICY,
  "hf-papers": HF_PAPERS_PROVIDER_POLICY,
  "osf-preprints": OSF_PROVIDER_POLICY,
  "msrb-emma": {
    requiresTermsAcceptance: "https://emma.msrb.org",
    notes:
      "EMMA gates data behind Terms-of-Use acceptance; after accepting, set msrbAcceptTermsOfUse: true to send the acceptance cookie.",
  },
  "cftc-cot": {
    notes:
      "Socrata Open Data API for CFTC Commitments of Traders. Unauthenticated requests share an IP throttling pool; for sustained polling create a free app token (https://publicreporting.cftc.gov/profile/edit/developer_settings) and pass it as appToken. Weekly cadence: positions as of Tuesday, normally published Friday 15:30 ET.",
  },
  "ffiec-cdr": {
    notes:
      "FFIEC CDR bulk data distribution is a stateful ASP.NET page: the postback chain needs the session cookies from the initial page load, and call-report archives run about 6 MB per quarter. Quarterly cadence; the page's Call Updated stamp moves when late filers revise a period.",
  },
  "dtcc-sdr": {
    notes:
      "DTCC Public Price Dissemination is free and keyless. The intraday slice catalog only retains the most recent days; older data must come from the cumulative end-of-day files, published in the evening US time and skipped on weekends and US holidays. Reported notionals of large trades are capped (trailing '+') under CFTC/SEC block-trade rules.",
  },
  "hf-transcripts": {
    notes:
      "Hugging Face datasets-server over the MIT-licensed kurry/sp500_earnings_transcripts snapshot (~685 US large-cap issuers — much of, but not all of, the S&P 500 — 2005 onward). Pages cap at 100 rows and transcript rows run ~50 KB each; new quarters appear when the dataset is republished, not in real time.",
  },
};

/**
 * Works-lane policies. Keyed separately from `PROVIDER_POLICIES` because a
 * catalog provider is not a `NewsProvider`: it answers queries with
 * bibliographic records, never with dated news items. Exhaustive by type —
 * every catalog xnews reaches has operational or rights caveats a consumer
 * must see before scheduling it.
 */
export const WORKS_PROVIDER_POLICIES: Record<WorksProvider, ProviderPolicy> = {
  libgen: {
    notes:
      "Unofficial mirrors rotate hostnames and publish no terms or uptime contract. Records expose no availability metadata and therefore use availability 'unknown'. Queries must be at least three characters.",
  },
  "open-library": {
    requiresDeclaredUserAgent: true,
    termsUrl: "https://openlibrary.org/developers/api",
    notes:
      "Open Library asks frequent callers to send a User-Agent naming the application and a contact address; identified requests get a higher allowance than anonymous ones. Catalog metadata only — availability reflects Open Library's own access signals and is never an assertion that a file may be redistributed.",
  },
  "internet-archive": {
    termsUrl: "https://archive.org/about/terms.php",
    notes:
      "Official advancedsearch.php and /metadata/<id> APIs, keyless and free; the Archive publishes no numeric rate ceiling but throttles heavy anonymous traffic, so identify the caller and keep concurrency low. Availability reflects the Archive's own stated rights and lending signals — a borrowable item is not a redistributable one.",
  },
  "annas-archive": {
    notes:
      "Unofficial mirrors rotate hostnames and publish no terms or uptime contract, so every URL requires a caller-supplied origin. Metadata search is keyless; the fast_download JSON API needs a paid membership key (annasArchiveKey) and allows a limited number of downloads per day.",
  },
};
