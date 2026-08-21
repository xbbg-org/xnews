export type NewsProvider =
  | "yahoo-finance"
  | "google-news"
  | "sec-edgar"
  | "finviz"
  | "bing-news"
  | "gdelt"
  | "tickertick"
  | "hacker-news"
  | "yahoo-search"
  | "sec-fulltext"
  | "sec-current"
  | "federal-register"
  | "courtlistener"
  | "msrb-emma"
  | "nasdaq"
  | "seeking-alpha"
  | "hf-transcripts"
  | "marketwatch"
  | "wsj"
  | "cnbc"
  | "pr-newswire"
  | "globenewswire"
  | "federal-reserve"
  | "sec-press"
  | "ffiec"
  | "fdic"
  | "occ"
  | "cfpb"
  | "coindesk"
  | "cointelegraph"
  | "benzinga"
  | "investing-com"
  | "upi"
  | "oilprice"
  | "nyt"
  | "bbc"
  | "npr"
  | "guardian"
  | "ft"
  | "economist"
  | "fortune"
  | "forbes"
  | "washington-post"
  | "youtube"
  | "cftc-cot"
  | "ffiec-cdr"
  | "dtcc-sdr"
  | "arxiv"
  | "openalex"
  | "bis-research"
  | "bis-research-hub"
  | "nber"
  | "ssrn"
  | "crossref"
  | "world-bank"
  | "biorxiv"
  | "medrxiv"
  | "europe-pmc"
  | "hf-papers"
  | "osf-preprints"
  | "bis-press"
  | "bis-speeches"
  | "bcb-news"
  | "boj-news"
  | "bok-news"
  | "rbi-news"
  | "bsp-news"
  | "hkma-news"
  | "rba-news"
  | "rbnz-news"
  | "banco-de-espana-news"
  | "banca-ditalia-news"
  | "dnb-news"
  | "central-bank-ireland-news"
  | "cnb-news"
  | "mnb-news"
  | "tcmb-news"
  | "sarb-news"
  | "norges-bank-news"
  | "riksbank-news"
  | "central-bank-iceland-news"
  | "ecb-news"
  | "bank-england-news"
  | "bank-canada-news"
  | "bundesbank-news"
  | "snb-news"
  | "atlanta-fed-news"
  | "richmond-fed-news"
  | "dallas-fed-news"
  | "fed-board-research"
  | "bcb-research"
  | "bok-research"
  | "hkma-research"
  | "ecb-research"
  | "bank-canada-research"
  | "bundesbank-research"
  | "norges-bank-research"
  | "snb-research"
  | "rba-research"
  | "banco-de-espana-research"
  | "banca-ditalia-research"
  | "dnb-research"
  | "ofac"
  | "who-outbreaks";

export type NewsProviderCapability = "company" | "topic" | "filing";

export type ProviderStatus = "ok" | "empty" | "unsupported" | "partial" | "error" | "disabled";

/**
 * Machine-readable classification for transport failures. `config` marks a
 * policy precondition that failed before any network I/O (missing SEC
 * User-Agent, EMMA terms not accepted, no fetch implementation); `unknown`
 * marks errors that did not originate in this library's transport.
 */
export type ProviderErrorCode =
  | "config"
  | "network"
  | "http_status"
  | "timeout"
  | "aborted"
  | "unknown";

export type MarketEventKind =
  | "filing"
  | "earnings"
  | "management"
  | "capital-markets"
  | "debt"
  | "preferred"
  | "dividend"
  | "rating"
  | "regulatory"
  | "legal"
  | "mna"
  | "fund-flows"
  | "analysis"
  | "press-release"
  | "market"
  | "unknown";

export type NewsKind =
  | "article"
  | "filing"
  | "press-release"
  | "analysis"
  | "video"
  | "data"
  | "unknown";

export interface CompanyNewsSubjectInput {
  readonly kind: "company";
  readonly ticker?: string;
  readonly companyName?: string;
  readonly cik?: string;
}

export interface TopicNewsSubjectInput {
  readonly kind: "topic";
  readonly query: string;
}

export type NewsSubjectInput = CompanyNewsSubjectInput | TopicNewsSubjectInput;

export interface NewsSubject {
  readonly kind: "company" | "topic";
  readonly key: string;
  readonly displayName: string;
  readonly ticker?: string;
  readonly companyName?: string;
  readonly cik?: string;
  readonly query?: string;
}

export interface NewsItem {
  id: string;
  provider: NewsProvider;
  kind: NewsKind;
  title: string;
  url: string;
  source: string;
  ticker?: string;
  publishedAt?: string;
  publishedAtText?: string;
  summary?: string;
  formType?: string;
  accessionNumber?: string;
  relatedTickers?: readonly string[];
  readonly canonicalUrl?: string;
  readonly cik?: string;
  readonly fileNumber?: string;
  readonly companyName?: string;
  readonly filingDate?: string;
  readonly reportDate?: string;
  readonly eventKind?: MarketEventKind;
  readonly tags?: readonly string[];
  readonly seenInProviders?: readonly NewsProvider[];
  readonly provenance?: readonly NewsItemProvenance[];
  research?: ResearchPaperMetadata;
}

export interface ResearchPaperMetadata {
  readonly authors?: readonly string[];
  readonly institution?: string;
  readonly country?: string;
  readonly series?: string;
  readonly issue?: string;
  readonly doi?: string;
  readonly jelCodes?: readonly string[];
  readonly categories?: readonly string[];
  readonly externalId?: string;
  readonly version?: string;
  readonly submittedAt?: string;
  readonly updatedAt?: string;
  readonly announcedAt?: string;
  readonly announceType?: string;
  readonly pdfUrl?: string;
  readonly licenseUrl?: string;
}

export interface ResearchPaper extends NewsItem {
  kind: "analysis";
  research: ResearchPaperMetadata;
}

export interface NewsItemProvenance {
  readonly provider: NewsProvider;
  readonly source: string;
  readonly url: string;
}

export type SourceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SourceFetchOptions {
  readonly fetch?: SourceFetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Maximum response body size in bytes; defaults to 32 MiB. */
  readonly maxResponseBytes?: number;
  /**
   * Redirect semantics enforced by xnews. `"follow"` (default) revalidates
   * policy on at most ten hops; the injected fetch receives `"manual"`.
   */
  readonly redirect?: RequestRedirect;
  /**
   * Allows a redirect to leave the requested origin even when a caller
   * User-Agent, sensitive query parameter, request body, or extra header
   * would otherwise refuse it. File downloads need this: catalogs mint a
   * short-lived token on their own host and redirect to a CDN. A redirect
   * into a private network address is still refused.
   */
  readonly allowCrossOriginRedirects?: boolean;
  readonly userAgent?: string;
  readonly secUserAgent?: string;
  /**
   * MSRB EMMA gates data behind a Terms-of-Use acceptance cookie. Accepting
   * those terms (https://emma.msrb.org) is the caller's act: without this
   * flag, EMMA requests fail closed with a `config` error instead of the
   * library accepting on the caller's behalf.
   */
  readonly msrbAcceptTermsOfUse?: boolean;
  readonly limit?: number;
  readonly since?: string | Date;
  readonly until?: string | Date;
}

export interface NewsFeedOptions extends SourceFetchOptions {
  readonly sources?: readonly NewsProvider[];
  readonly strict?: boolean;
  readonly secForms?: readonly string[];
  /** API key required for opt-in OpenAlex Works retrieval. */
  readonly openAlexApiKey?: string;
  /** Restricts opt-in arXiv results; leaf IDs match exactly, while archives like `econ` include all subcategories. */
  readonly arxivCategories?: string | readonly string[];
  /** Restricts opt-in BIS research results to these exact institution names. */
  readonly bisInstitutions?: readonly string[];
  /** Restricts opt-in SSRN results to these networks; names or numeric binding ids. */
  readonly ssrnNetworks?: readonly ("fen" | "arn" | "ern" | number)[];
  /** Extra Crossref `filter` facets merged into opt-in Crossref queries. */
  readonly crossrefFilters?: Readonly<Record<string, string | readonly string[]>>;
  /** Restricts opt-in World Bank results to these document types. */
  readonly worldBankDocTypes?: readonly string[];
  /** Restricts opt-in bioRxiv/medRxiv results to these subject categories. */
  readonly bioRxivCategories?: readonly string[];
  /** Restricts opt-in OSF results to these preprint providers (e.g. `socarxiv`). */
  readonly osfProviders?: readonly string[];
}

export interface CompanyNewsQuery extends NewsFeedOptions {
  readonly ticker: string;
  readonly companyName?: string;
  readonly cik?: string;
}

export interface TopicNewsQuery extends NewsFeedOptions {
  readonly query: string;
}

export interface WatchNewsOptions extends CompanyNewsQuery {
  readonly intervalMs?: number;
  readonly seenIds?: Iterable<string>;
}

export interface WatchTopicNewsOptions extends TopicNewsQuery {
  readonly intervalMs?: number;
  readonly seenIds?: Iterable<string>;
}

export interface ProviderError {
  readonly message: string;
  /** Machine-readable classification; `unknown` for non-transport failures. */
  readonly code?: ProviderErrorCode;
  readonly status?: number;
  readonly url?: string;
}

export interface ProviderResult {
  readonly provider: NewsProvider;
  readonly status: ProviderStatus;
  readonly capabilities: readonly NewsProviderCapability[];
  readonly itemCount: number;
  readonly items: readonly NewsItem[];
  /**
   * Items dropped by a `since`/`until` window because they carry no parseable
   * publication date. Library-generated results always include this count;
   * the field remains optional so 0.1.x consumer-defined result fixtures stay
   * assignable to this public interface.
   */
  readonly undatedExcluded?: number;
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly durationMs: number;
  readonly requestUrls: readonly string[];
  readonly error?: ProviderError;
}

export interface NewsFeedResult {
  readonly subject: NewsSubject;
  readonly items: readonly NewsItem[];
  readonly providers: readonly ProviderResult[];
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly partial: boolean;
}

export interface NewsFeedQuery extends NewsFeedOptions {
  readonly subject: NewsSubjectInput;
}

export interface WatchlistNewsQuery extends NewsFeedOptions {
  readonly subjects: readonly NewsSubjectInput[];
}

export interface WatchlistSubjectResult {
  readonly subject: NewsSubject;
  readonly result: NewsFeedResult;
}

export interface WatchlistNewsFeedResult {
  readonly subjects: readonly WatchlistSubjectResult[];
  readonly items: readonly NewsItem[];
  readonly providers: readonly ProviderResult[];
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly partial: boolean;
}

export interface WatchlistNewsOptions extends WatchlistNewsQuery {
  readonly intervalMs?: number;
  readonly seenIds?: Iterable<string>;
}

/**
 * A dated payload of structured rows from a scheduled data publisher — the
 * data lane's counterpart of a news article. `asOf` is the date the rows
 * describe, which for scheduled releases precedes publication: CFTC COT rows
 * are as of Tuesday and normally published Friday afternoon.
 */
export interface DataRelease<Row> {
  /** Data-source identifier; data-only sources such as FRED need not be a `NewsProvider`. */
  readonly provider: string;
  readonly dataset: string;
  /** ISO date (`YYYY-MM-DD`) the rows are stated as of. */
  readonly asOf: string;
  /**
   * Publisher's monotonic release counter, for datasets that publish many
   * releases per `asOf` date (e.g. DTCC intraday slice IDs). When present,
   * `createDataReleaseWatcher` orders and dedupes on `sequence` instead of
   * `asOf`, and drains a backlog of sequenced releases without sleeping
   * between polls.
   */
  readonly sequence?: number;
  /** Canonical human-facing URL for the dataset. */
  readonly url: string;
  /**
   * ISO date (`YYYY-MM-DD`) the publisher last revised this dataset, when
   * the publisher exposes one (e.g. FFIEC CDR's "Call Updated" stamp).
   * Late refilings can move `updatedAt` without changing `asOf`; the
   * release watcher keys on `asOf` alone, so a refile of an already-seen
   * period does not re-yield. Watch the publisher's stamp directly (e.g.
   * `fetchFfiecBulkPage().callUpdated`) when revisions matter.
   */
  readonly updatedAt?: string;
  readonly rows: readonly Row[];
}

/**
 * Transport options for one data-release fetch. `ifNewerThan` is a skip
 * hint, not a filter: a source MAY resolve `undefined` without dialing its
 * heavy endpoints when it can cheaply determine the current release is not
 * strictly newer than this ISO date. `createDataReleaseWatcher` passes the
 * last yielded `asOf` here so multi-megabyte sources (e.g. FFIEC bulk zips)
 * are not re-downloaded every poll. Sources are free to ignore it.
 */
export interface DataFetchOptions extends SourceFetchOptions {
  readonly ifNewerThan?: string;
  /**
   * Exclusive lower bound for sequenced datasets: return the earliest
   * release whose `sequence` is strictly greater, or `undefined` when the
   * consumer is caught up. Without it a sequenced source returns its latest
   * release. `createDataReleaseWatcher` passes the last yielded `sequence`
   * here so a backlog is consumed in order and without gaps. Sources that
   * publish one release per `asOf` ignore it.
   */
  readonly afterSequence?: number;
}

/**
 * Binds one provider dataset to its transport: everything the data lane's
 * generic machinery (`fetchDataRelease`, `createDataReleaseWatcher`) needs
 * to fetch and label releases. Built-in providers export factories returning
 * sources (see `cotDataSource`); consumers can implement `DataSource` for
 * their own publishers and reuse the same machinery.
 */
export interface DataSource<Row> {
  readonly provider: string;
  readonly dataset: string;
  /** URLs the next `fetchRelease` call would dial, for observability. */
  requestUrls(options?: DataFetchOptions): readonly string[];
  /** Resolves `undefined` when the dataset currently has no matching data. */
  fetchRelease(options?: DataFetchOptions): Promise<DataRelease<Row> | undefined>;
}

/** Uniform non-throwing outcome envelope for one data-release fetch. */
export interface DataProviderResult<Row> {
  readonly provider: string;
  readonly dataset: string;
  readonly status: ProviderStatus;
  /** Present unless the fetch failed or found no data at all. */
  readonly release?: DataRelease<Row>;
  readonly rowCount: number;
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly durationMs: number;
  readonly requestUrls: readonly string[];
  readonly error?: ProviderError;
}

export interface DataReleaseWatcherOptions extends SourceFetchOptions {
  /** Poll interval in milliseconds; defaults to 15 minutes. */
  readonly intervalMs?: number;
  /** Only releases with `asOf` strictly after this ISO date are yielded. */
  readonly sinceAsOf?: string;
  /**
   * For sequenced sources: only releases with `sequence` strictly greater
   * than this are yielded, so restarts do not replay consumed releases.
   */
  readonly sinceSequence?: number;
}

/**
 * Built-in event providers. The events lane carries *active-state* feeds:
 * publishers that answer with the set of things currently in force — storm
 * warnings, elevated volcanoes, airport ground stops, outage summaries —
 * rather than a dated release or a bibliographic record.
 *
 * Neither existing lane fits. `DataRelease` is keyed on `asOf` and
 * `createDataReleaseWatcher` dedupes on it, so an alert set that changes
 * continuously would yield at most once per day. `NewsItem` has no geometry
 * and no lifecycle window. So the events lane has its own machinery
 * (see `src/events.ts`), which dedupes on event id and yields events as they
 * *appear*, the way `createTopicNewsWatcher` does for documents.
 */
export type BuiltInEventProvider =
  | "nws-alerts"
  | "gdacs"
  | "nhc-storms"
  | "usgs-volcanoes"
  | "noaa-tsunami"
  | "glofas-flood"
  | "gdelt-events"
  | "faa-status"
  | "safecast-radiation"
  | "sondehub-balloons";

/** Backward-compatible name for the built-in provider union. */
export type EventProvider = BuiltInEventProvider;

/**
 * What an event is about. Deliberately coarse: consumers filter on this
 * before reading provider-native fields, so it stays stable as providers
 * are added.
 */
export type EventCategory =
  | "hazard"
  | "weather"
  | "seismic"
  | "flood"
  | "conflict"
  | "outage"
  | "aviation"
  | "radiation"
  | "atmospheric"
  | "unknown";

/**
 * Normalized urgency, mapped from each publisher's native scale (NWS
 * `severity`, GDACS alert colour, USGS volcano alert level). `unknown` means
 * the publisher stated nothing recognized — never a silent downgrade to
 * `minor`, because an unranked alert is not a mild one.
 */
export type EventSeverity = "extreme" | "severe" | "moderate" | "minor" | "unknown";

/**
 * One active event or observation. Geometry is both-or-neither: some
 * publishers (FAA airport status) state a place but no coordinates, and a
 * fabricated or half-present point would read as measured position.
 */
interface EventRecordFields<Provider extends string> {
  /** Provider-native id where one exists, else derived; stable within `provider`. */
  readonly id: string;
  readonly provider: Provider;
  readonly category: EventCategory;
  readonly title: string;
  readonly summary?: string;
  /** Canonical human-facing URL, when the publisher exposes one. */
  readonly url?: string;
  /** ISO instant the publisher stated this record; absent when unstated. */
  readonly observedAt?: string;
  /** Lifecycle window, for events that declare one (warning in force). */
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly latitude?: never;
  readonly longitude?: never;
  readonly severity: EventSeverity;
  /**
   * The publisher's own scalar, unconverted — earthquake magnitude, alert
   * level, river discharge, µSv/h. Meaning is provider-specific; read it
   * with `magnitudeUnit`.
   */
  readonly magnitude?: number;
  readonly magnitudeUnit?: string;
  /** ISO 3166-1 alpha-2 where the publisher states a country. */
  readonly countryCode?: string;
  readonly areaName?: string;
  /** Provider-native classification, verbatim (NWS `event`, GDACS `eventtype`). */
  readonly eventType?: string;
}

export type EventRecord<Provider extends string = BuiltInEventProvider> =
  | EventRecordFields<Provider>
  | (Omit<EventRecordFields<Provider>, "latitude" | "longitude"> & {
      readonly latitude: number;
      readonly longitude: number;
    });

/**
 * The set of events in force at one moment. A snapshot is the whole current
 * state, not a delta: `createEventWatcher` computes deltas by id.
 */
export interface EventSnapshot<Provider extends string = BuiltInEventProvider> {
  readonly provider: Provider;
  readonly dataset: string;
  /** ISO instant the snapshot was taken. */
  readonly observedAt: string;
  readonly events: readonly EventRecord<Provider>[];
  readonly warnings: readonly string[];
  readonly requestUrls: readonly string[];
}

/**
 * Binds one active-state publisher to its transport. Built-in providers
 * export factories returning sources (see `nwsAlertsSource`); consumers can
 * implement `EventSource` for their own publishers and reuse the lane.
 */
export interface EventSource<Provider extends string = BuiltInEventProvider> {
  readonly provider: Provider;
  readonly dataset: string;
  /** URLs the next `fetchSnapshot` call would dial, for observability. */
  requestUrls(options?: EventFetchOptions): readonly string[];
  /** Resolves `undefined` when the publisher currently reports nothing active. */
  fetchSnapshot(options?: EventFetchOptions): Promise<EventSnapshot<Provider> | undefined>;
}

export interface EventFetchOptions extends SourceFetchOptions {
  /** Drop events below this normalized urgency. */
  readonly minSeverity?: EventSeverity;
  /** Restrict to these ISO 3166-1 alpha-2 countries, where the publisher states one. */
  readonly countryCodes?: readonly string[];
}

/** Uniform non-throwing outcome envelope for one snapshot fetch. */
export interface EventProviderResult<Provider extends string = BuiltInEventProvider> {
  readonly provider: Provider;
  readonly dataset: string;
  readonly status: ProviderStatus;
  /** Present unless the fetch failed or found nothing active. */
  readonly snapshot?: EventSnapshot<Provider>;
  /** Full current-state event set; identical to `snapshot.events` when present. */
  readonly events: readonly EventRecord<Provider>[];
  readonly eventCount: number;
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly durationMs: number;
  readonly requestUrls: readonly string[];
  readonly error?: ProviderError;
}

/** Watcher result: full snapshot plus only the ids that appeared on this poll. */
export interface EventWatcherResult<
  Provider extends string = BuiltInEventProvider,
> extends EventProviderResult<Provider> {
  readonly addedEvents: readonly EventRecord<Provider>[];
}

export interface EventWatcherOptions extends EventFetchOptions {
  /** Poll interval in milliseconds; defaults to 5 minutes. */
  readonly intervalMs?: number;
  /** Event ids already consumed, so a restart does not replay them. */
  readonly seenIds?: Iterable<string>;
  /**
   * Cap on remembered ids, bounding memory on high-churn publishers.
   * Defaults to 10000; oldest ids are evicted first.
   */
  readonly maxSeenIds?: number;
}

/**
 * Built-in works providers. The works lane is bibliographic catalog lookup:
 * news providers answer with dated documents and data providers with dated
 * rows, but a works provider answers a *query* with catalog records that
 * carry no release date and have no natural time ordering. Neither lane's
 * machinery fits, so the works lane has its own (see `src/works.ts`).
 *
 * `annas-archive` and `libgen` are mirror-based: they dial only origins the
 * caller supplies (see `src/mirrors.ts`). `internet-archive` and
 * `open-library` have stable official APIs and carry their own origin.
 */
export type WorksProvider = "annas-archive" | "internet-archive" | "libgen" | "open-library";

/**
 * Catalog-reported access signal. `open-access` and `public-domain` report the
 * corresponding catalog classification; `preview` and `borrow` report limited
 * access modes; `metadata-only` reports no file access; and `unknown` means
 * the catalog supplied no recognized availability metadata.
 */
export type WorkAvailability =
  | "open-access"
  | "public-domain"
  | "preview"
  | "borrow"
  | "metadata-only"
  | "unknown";

/**
 * Whether identifiers came from the record itself or were inferred by
 * matching it against an authoritative catalog.
 */
export type WorkIdentityOrigin = "record" | "resolved";

/**
 * Bibliographic identifiers for one record. Catalogs that scrape file
 * listings often state none of them, which is why `origin` and `confidence`
 * are part of the identity rather than assumed by callers.
 */
export interface WorkIdentity {
  readonly isbn13?: string;
  readonly isbn10?: string;
  readonly doi?: string;
  readonly oclc?: string;
  readonly lccn?: string;
  readonly openLibraryId?: string;
  /** Content hash, for catalogs that address files rather than editions. */
  readonly md5?: string;
  /**
   * `"record"` means the provider stated these identifiers. `"resolved"`
   * means `resolveWorkIdentity` inferred them from a fuzzy match against an
   * authoritative catalog; callers MUST check `confidence` before treating
   * them as authoritative.
   */
  readonly origin: WorkIdentityOrigin;
  /** 0-1, and always 1 when `origin` is `"record"`. */
  readonly confidence: number;
}

/** One provider's claim about where a record was seen. */
export interface WorkRecordProvenance {
  readonly provider: string;
  readonly url: string;
}

/**
 * One bibliographic record, normalized across catalogs. Numeric fields are
 * absent rather than zero when the provider stated an uncoercible value, and
 * the reason lands in `warnings` so a layout change surfaces instead of
 * silently degrading every row.
 */
export interface WorkRecord {
  /** Built-in providers use their `WorksProvider` name (e.g. `"libgen"`). */
  readonly provider: string;
  /** Provider-native record id, stable within `provider`. */
  readonly sourceId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly authors: readonly string[];
  readonly publisher?: string;
  readonly publishedYear?: number;
  readonly edition?: string;
  readonly series?: string;
  readonly language?: string;
  /** Lowercase file extension, when the record describes a file. */
  readonly format?: string;
  readonly pageCount?: number;
  readonly sizeBytes?: number;
  readonly identity: WorkIdentity;
  readonly availability: WorkAvailability;
  /** Canonical absolute human-facing URL for the record. */
  readonly url: string;
  /** ISO instant the catalog first listed the record, when stated. */
  readonly addedAt?: string;
  /** ISO instant the catalog last revised the record, when stated. */
  readonly modifiedAt?: string;
  readonly warnings: readonly string[];
  readonly provenance: readonly WorkRecordProvenance[];
}

/**
 * One catalog query. At least one of the query fields must be set; sources
 * reject an empty query with a `config` error rather than dialing a catalog
 * with no terms. `limit` caps returned records and `maxPages` caps how many
 * result pages a paginating source walks to reach that limit.
 */
export interface WorksQuery extends SourceFetchOptions {
  /** Free-text query across whatever fields the catalog searches. */
  readonly query?: string;
  readonly title?: string;
  readonly author?: string;
  readonly isbn?: string;
  readonly doi?: string;
  /** First result page to read, 1-based; defaults to 1. */
  readonly page?: number;
  /** Max result pages to walk; defaults to 1. */
  readonly maxPages?: number;
}

/** One page of catalog records plus what it took to get them. */
export interface WorksPage<Item = WorkRecord> {
  readonly items: readonly Item[];
  /** 1-based page number of the first page read. */
  readonly page: number;
  /** Whether the catalog indicated further pages past those read. */
  readonly hasMore: boolean;
  /** Total matches the catalog claims, when it states one. */
  readonly totalCount?: number;
  readonly warnings: readonly string[];
  readonly requestUrls: readonly string[];
}

/**
 * Binds one catalog to its transport: everything `searchWorks` needs to query
 * it and label the results. Built-in providers export factories returning
 * sources (see `libgenSource`, `openLibrarySource`); consumers can implement
 * `WorksSource` for their own catalogs and reuse the same machinery.
 */
export interface WorksSource {
  readonly provider: string;
  /** URLs the next `search` call would dial, for observability. */
  requestUrls(query: WorksQuery): readonly string[];
  search(query: WorksQuery): Promise<WorksPage>;
}

/** Uniform non-throwing outcome envelope for one catalog search. */
export interface WorksResult {
  readonly provider: string;
  readonly status: ProviderStatus;
  /** Present unless the search failed outright. */
  readonly page?: WorksPage;
  readonly items: readonly WorkRecord[];
  readonly recordCount: number;
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly durationMs: number;
  readonly requestUrls: readonly string[];
  readonly error?: ProviderError;
}

/** One scored authoritative candidate for a record being resolved. */
export interface WorkIdentityCandidate {
  readonly record: WorkRecord;
  /** 0-1 similarity against the record being resolved. */
  readonly score: number;
}

/**
 * Outcome of resolving a record's identifiers against an authoritative
 * catalog. `matched` is set only when the best candidate met the confidence
 * floor; `candidates` is always populated so callers can review near misses.
 */
export interface WorkIdentityResolution {
  readonly identity: WorkIdentity;
  readonly matched?: WorkRecord;
  readonly candidates: readonly WorkIdentityCandidate[];
  readonly warnings: readonly string[];
  /**
   * Status of the authoritative lookup. `error` and `disabled` mean the
   * catalog never answered, so an absent `matched` states nothing about
   * whether the work exists — distinguishing that from a genuine no-match is
   * why this is not left to warning prose.
   */
  readonly status: ProviderStatus;
  /** Set when `status` is `error` or `disabled`. */
  readonly error?: ProviderError;
}

export interface ResolveWorkIdentityOptions extends SourceFetchOptions {
  /** Minimum score to accept as a match; defaults to 0.82. */
  readonly minConfidence?: number;
  /** Max authoritative candidates to score; defaults to 10. */
  readonly maxCandidates?: number;
}
