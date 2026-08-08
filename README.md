# xnews

[![CI](https://github.com/xbbg-org/xnews/actions/workflows/ci.yml/badge.svg)](https://github.com/xbbg-org/xnews/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@xbbg/xnews.svg)](https://www.npmjs.com/package/@xbbg/xnews)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Pure fetch/parse/normalize utilities for building company, topic, watchlist, and research feeds, plus scheduled economic-data releases and bibliographic catalog lookup. xnews covers public market-news feeds, research-paper metadata, central-bank publications, structured data releases, book and document catalogs, and YouTube media, and reads the documents it finds — EPUB, PDF, DjVu, MOBI, and CBZ text with no runtime dependency. It does not persist data, schedule jobs, store state, score sentiment, or provide investment advice.

## Install

```sh
npm install @xbbg/xnews
```

```sh
bun add @xbbg/xnews
```

Requires Node 24 or newer. The package is **ESM-only**: it exports ESM from `dist/index.js` with TypeScript declarations at `dist/index.d.ts`, and has no CommonJS build. CommonJS callers must use a dynamic `import()`.

## Subpath exports

- `@xbbg/xnews/catalog` exports URL builders for every provider, `FIXED_FEEDS`, `PROVIDER_POLICIES`, and `WORKS_PROVIDER_POLICIES`. It is structurally network-free: its import graph never reaches the fetch layer.
- `@xbbg/xnews/parsers` exports pure parsers, the shared `readZipEntries` and `parseCsvRecords`/`parseCsvTable` readers, and `parsePublishedAt`.
- `@xbbg/xnews/asr` exports transcription APIs.

## Company feed

```ts
import { buildCompanyNewsFeed, buildCompanyNewsFeedResult } from "@xbbg/xnews";

const items = await buildCompanyNewsFeed({
  ticker: "RGA",
  companyName: "Reinsurance Group of America",
  secForms: ["8-K"],
  limit: 20,
  secUserAgent: "my-app/1.0 ops@example.com",
});

const result = await buildCompanyNewsFeedResult({
  ticker: "RGA",
  companyName: "Reinsurance Group of America",
  sources: ["yahoo-finance", "google-news", "sec-edgar", "finviz"],
});

console.table(
  result.providers.map(({ provider, status, itemCount, warnings }) => ({
    provider,
    status,
    itemCount,
    warnings: warnings.join("; "),
  })),
);
```

`buildCompanyNewsFeed(...)` returns `Promise<NewsItem[]>`. `buildCompanyNewsFeedResult(...)` returns provider diagnostics, warnings, request URLs, `partial`, and the normalized subject metadata.

## Topic feed

```ts
import { buildTopicNewsFeed, buildNewsFeedResult } from "@xbbg/xnews";

const topicItems = await buildTopicNewsFeed({ query: "insurance regulation", limit: 10 });

const topicResult = await buildNewsFeedResult({
  subject: { kind: "topic", query: "insurance regulation" },
  sources: ["google-news", "sec-edgar", "finviz"],
});
```

Topic feeds default to Google News only in this version. Pass `sources` to fan a topic out to any topic-capable provider from the catalog below. If unsupported providers are explicitly requested for a topic subject, those providers are not fetched and their `ProviderResult.status` is `"unsupported"` with a warning such as `"finviz: topic subjects are unsupported"`.

## Research papers

Research is separate from structured data: paper adapters return `ResearchPaper` items with `kind: "analysis"`, while FRED and the release watchers below return dated data rows.

### Standalone discovery

```ts
import {
  fetchArxivAnnouncements,
  fetchArxivPapers,
  fetchBisResearchHub,
  fetchBisWorkingPapers,
  fetchOpenAlexWorks,
} from "@xbbg/xnews";

const arxivTopic = await fetchArxivPapers('all:"monetary policy"', {
  sortBy: "submittedDate",
  sortOrder: "descending",
  limit: 10,
});
const arxivCategories = await fetchArxivAnnouncements(["econ.EM", "q-fin.EC"], {
  limit: 10,
});

const openAlex = await fetchOpenAlexWorks("monetary policy", {
  apiKey: process.env.OPENALEX_API_KEY!,
  sort: "publication_date:desc",
  perPage: 10,
});

const bisWorkingPapers = await fetchBisWorkingPapers({ limit: 10 });
const researchHub = await fetchBisResearchHub({
  query: "inflation expectations",
  institutions: ["European Central Bank"],
  limit: 10,
});

console.log(
  arxivTopic[0]?.research.authors,
  arxivCategories[0]?.research.categories,
  openAlex.items[0]?.research.doi,
  bisWorkingPapers[0]?.research.issue,
  researchHub[0]?.research.institution,
);
```

`fetchArxivPapers` searches arXiv's legacy API; `fetchArxivAnnouncements` reads current category announcements. `fetchOpenAlexWorks` returns a cursor page (`items`, `count`, `nextCursor`, `perPage`). `fetchBisWorkingPapers` reads the BIS Working Papers snapshot, while `fetchBisResearchHub` searches the broad, multi-institution Central Bank Research Hub snapshot; use `fetchBisResearchHubRecent` for its recent-additions RSS feed. URL builders and pure parsers for each source are also exported.

Nine more research surfaces follow the same shape — none needs an API key:

```ts
import {
  fetchBioRxivPapers,
  fetchCrossrefWorks,
  fetchEuropePmcPapers,
  fetchHfDailyPapers,
  fetchNberWorkingPapers,
  fetchOsfPreprints,
  fetchSsrnPapers,
  fetchWorldBankDocuments,
} from "@xbbg/xnews";

const nber = await fetchNberWorkingPapers({ q: "inflation", limit: 10 });
const ssrn = await fetchSsrnPapers("fen", { limit: 10 }); // fen | arn | ern | numeric binding id
const crossref = await fetchCrossrefWorks("market liquidity", {
  filters: { type: "journal-article", "from-pub-date": "2026-01-01" },
  mailto: "you@example.com", // joins Crossref's polite pool
  limit: 10,
});
const prwp = await fetchWorldBankDocuments("inflation", {
  docTypes: ["Policy Research Working Paper"],
  limit: 10,
});
const medrxiv = await fetchBioRxivPapers({ server: "medrxiv", categories: ["endocrinology"] });
const biomed = await fetchEuropePmcPapers("glp-1 AND SRC:PPR", { resultType: "core", limit: 10 });
const aiPapers = await fetchHfDailyPapers({ date: "2026-08-06" });
const socarxiv = await fetchOsfPreprints({ providers: ["socarxiv"], publishedSince: "2026-08-01" });
```

`fetchNberWorkingPapers` searches NBER's listing API (`q`, `page`, `perPage`) and `fetchNberRecentPapers` reads the official RSS feed. `fetchSsrnPapers` lists a network's newest approved papers (`SSRN_NETWORKS` maps `fen`/`arn`/`ern`; any numeric binding id works). `fetchCrossrefWorks` exposes Crossref's full `filter`/`select`/sort/cursor surface and returns a page (`items`, `totalResults`, `nextCursor`). `fetchWorldBankDocuments` passes through WDS facets (`docTypes`, `languages`, date ranges, `extraParams`). `fetchBioRxivPapers` walks a date window on bioRxiv or medRxiv with cursor paging and optional category filtering. `fetchEuropePmcPapers` passes the Europe PMC query language through untouched and pages by `cursorMark`. `fetchHfDailyPapers` lists Hugging Face's community-curated daily arXiv papers. `fetchOsfPreprints` filters OSF preprint providers (SocArXiv, PsyArXiv, ...) with date bounds and returns `nextUrl` paging.

The same sources can participate in company/topic feeds, but they are all opt-in:

```ts
import { buildTopicNewsFeed } from "@xbbg/xnews";

const papers = await buildTopicNewsFeed({
  query: "inflation expectations",
  sources: ["arxiv", "openalex", "bis-research", "bis-research-hub"],
  openAlexApiKey: process.env.OPENALEX_API_KEY!,
  arxivCategories: ["econ.EM"],
  bisInstitutions: ["European Central Bank"],
  limit: 25,
});

const broader = await buildTopicNewsFeed({
  query: "inflation",
  sources: ["nber", "ssrn", "crossref", "world-bank", "europe-pmc"],
  ssrnNetworks: ["fen", "ern"],
  crossrefFilters: { type: "journal-article" },
  worldBankDocTypes: ["Policy Research Working Paper"],
  limit: 25,
});
```

Feed-level research filters: `ssrnNetworks` (named or numeric bindings), `crossrefFilters` (merged into the Crossref `filter` parameter), `worldBankDocTypes`, `bioRxivCategories`, and `osfProviders`.

Every paper carries ordinary `NewsItem` identity, source, date, summary, and link fields plus optional `research` metadata supplied upstream: authors, institution/country, series and issue, DOI, JEL codes, categories, external ID, version and submission/update/announcement dates, and PDF/license URLs. A `pdfUrl` is only a source link; xnews does not download or redistribute the paper. When merged feed items share a canonical or item URL, xnews keeps one item and records every contributing source in `seenInProviders` and `provenance`. Different URLs remain separate even when metadata appears related; use DOI or `externalId` if an application needs stronger cross-catalog deduplication.

### Research API and content policies

- **arXiv:** Leave at least three seconds between legacy API requests (`ARXIV_MIN_REQUEST_INTERVAL_MS`) and use one connection at a time; xnews exposes the interval but does not add a global sleep. arXiv API metadata is [CC0](https://info.arxiv.org/help/api/tou.html), but article PDFs and source files are not generally redistributable unless the paper's license or rights holder permits it. Link to arXiv by default.
- **OpenAlex:** The xnews adapter requires `apiKey`; see OpenAlex [authentication and pricing](https://developers.openalex.org/guides/authentication). OpenAlex data is [CC0](https://developers.openalex.org/), but API budgets and rate limits still apply; honor the response headers.
- **BIS and Research Hub/RePEc records:** These adapters return metadata and source links, not PDF bytes. RePEc indexing or public download access does not grant commercial redistribution rights. Review the [BIS terms](https://www.bis.org/terms_conditions.htm) and request [BIS permission](https://www.bis.org/permission_requests.htm) or permission from the linked institution/rightsholder when the intended use requires it; source-link-only is the safe default.
- **NBER and SSRN:** Both listing endpoints are the sites' own undocumented APIs (NBER's RSS feed is its stable official surface) and may change or be restricted without notice; SSRN's is an Elsevier endpoint discovered from papers.ssrn.com browsing. Both adapters return metadata and landing links only; papers remain governed by publisher terms.
- **Crossref and World Bank:** Free public APIs. Pass `mailto` to join Crossref's [polite pool](https://api.crossref.org); Crossref abstracts are publisher-supplied and may carry publisher rights. Most World Bank publications are CC BY 4.0, but each record's license statement is authoritative.
- **bioRxiv/medRxiv, Europe PMC, and OSF:** Free, keyless APIs with per-record content licenses; only the metadata is openly reusable across the board. The bioRxiv details endpoint can take tens of seconds. OSF throttles unauthenticated traffic.
- **Hugging Face daily papers:** Undocumented but widely used endpoint over community-curated arXiv listings; treat availability and shape as best-effort.

## Source catalog

Company feeds default to `sec-edgar`, `yahoo-finance`, `google-news`, and `finviz`; topic feeds default to `google-news`. Every other provider is opt-in through `sources`. Sources are public feeds and APIs, but they do not all have the same access requirements: for example, OpenAlex requires `openAlexApiKey`, SEC requires a declared user agent, and EMMA requires recorded terms acceptance.

### Query providers

These providers query their upstream endpoint per subject.

| Provider           | Capabilities           | Company subject needs | Endpoint                                                                                                                                        |
| ------------------ | ---------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `yahoo-finance`    | company                | ticker                | Yahoo Finance per-symbol RSS                                                                                                                    |
| `google-news`      | company, topic         | companyName or ticker | Google News search RSS                                                                                                                          |
| `sec-edgar`        | company, filing        | ticker or CIK         | SEC EDGAR company Atom (`secForms` supported)                                                                                                   |
| `finviz`           | company                | ticker                | Finviz quote-page news table                                                                                                                    |
| `bing-news`        | company, topic         | companyName or ticker | Bing News search RSS (redirect links unwrapped)                                                                                                 |
| `gdelt`            | company, topic         | companyName or ticker | GDELT DOC 2.0 API (~1 request / 5 s per IP)                                                                                                     |
| `tickertick`       | company                | ticker                | TickerTick API (10 requests / minute per IP)                                                                                                    |
| `hacker-news`      | company, topic         | companyName or ticker | Algolia Hacker News search API                                                                                                                  |
| `yahoo-search`     | company, topic         | companyName or ticker | Yahoo Finance search API (JSON)                                                                                                                 |
| `sec-fulltext`     | company, topic, filing | companyName or ticker | SEC EDGAR full-text search (`secForms` supported)                                                                                               |
| `sec-current`      | company, topic, filing | companyName           | SEC EDGAR latest-filings stream (`secForms` supported; company uses EDGAR's name search over current filings, topics filter the stream locally) |
| `federal-register` | company, topic         | companyName           | Federal Register documents API                                                                                                                  |
| `courtlistener`    | company, topic         | companyName           | CourtListener opinion search feed                                                                                                               |
| `msrb-emma`        | company, topic, filing | companyName           | MSRB EMMA municipal continuing disclosures (rating changes, bond calls, financials; subjects filter the stream locally by issuer name or query) |
| `nasdaq`           | company                | ticker                | Nasdaq per-symbol RSS                                                                                                                           |
| `seeking-alpha`    | company                | ticker                | Seeking Alpha per-symbol RSS                                                                                                                    |
| `hf-transcripts`   | company                | ticker                | Hugging Face datasets-server over the MIT-licensed `kurry/sp500_earnings_transcripts` snapshot (~685 US large-cap issuers, 2005 onward)         |
| `arxiv`            | company, topic         | companyName or ticker | arXiv legacy Atom search (opt-in; `arxivCategories` accepts exact leaf IDs or whole archives)                                                   |
| `openalex`         | company, topic         | companyName or ticker | OpenAlex Works API (opt-in; `openAlexApiKey` required)                                                                                          |
| `bis-research`     | company, topic         | companyName or ticker | Complete BIS Working Papers snapshot, filtered locally (opt-in)                                                                                 |
| `bis-research-hub` | company, topic         | companyName or ticker | Recent Central Bank Research Hub additions, filtered upstream/locally (opt-in)                                                                  |
| `nber`             | company, topic         | companyName or ticker | NBER working-paper listing with native `q` search (opt-in; abstracts included)                                                                  |
| `ssrn`             | company, topic         | companyName or ticker | SSRN newest approved papers per network, filtered locally (opt-in; `ssrnNetworks`, title-only matching — listings carry no abstracts)           |
| `crossref`         | company, topic         | companyName or ticker | Crossref Works search (opt-in; `crossrefFilters` merges into the `filter` parameter)                                                            |
| `world-bank`       | company, topic         | companyName or ticker | World Bank Documents & Reports search (opt-in; `worldBankDocTypes`)                                                                             |
| `biorxiv`          | company, topic         | companyName or ticker | bioRxiv recent preprints window, filtered locally (opt-in; `bioRxivCategories`)                                                                 |
| `medrxiv`          | company, topic         | companyName or ticker | medRxiv recent preprints window, filtered locally (opt-in; `bioRxivCategories`)                                                                 |
| `europe-pmc`       | company, topic         | companyName or ticker | Europe PMC search over PubMed, PMC, and preprints (opt-in)                                                                                      |
| `hf-papers`        | company, topic         | companyName or ticker | Hugging Face daily AI papers, filtered locally (opt-in)                                                                                         |
| `osf-preprints`    | company, topic         | companyName or ticker | OSF preprints across community archives, filtered locally (opt-in; `osfProviders`)                                                              |

`since`/`until` date windows are forwarded upstream where the endpoint supports them (`gdelt`, `sec-fulltext`, `federal-register`, `courtlistener`, arXiv submitted dates, OpenAlex publication dates, Crossref publication dates, Europe PMC `FIRST_PDATE`, World Bank document dates, bioRxiv/medRxiv detail windows, and OSF publication dates) and always enforced locally after fetching. `msrb-emma` maps `since` onto EMMA's fixed posting windows: it fetches Today+Yesterday by default and widens to ThisWeek/LastWeek (EMMA's maximum lookback) when the window reaches further back.

Using `msrb-emma` requires `msrbAcceptTermsOfUse: true`. Setting the flag records the caller's acceptance of EMMA's Terms of Use.

### Fixed market and business feeds

These providers fetch whole public feeds and filter items locally against the subject: topic queries require every query token; company subjects match the company name as a phrase or the ticker as a standalone uppercase token (`RGA`, `$RGA`, `NYSE:RGA`). Single-letter tickers only match with cashtag or exchange context. An `"empty"` status usually means the current headlines simply do not mention the subject.

| Provider          | Feed                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `marketwatch`     | MarketWatch top stories, real-time headlines, market pulse, bulletins |
| `wsj`             | The Wall Street Journal markets and US business                       |
| `cnbc`            | CNBC top news, investing, earnings                                    |
| `pr-newswire`     | PR Newswire all news releases                                         |
| `globenewswire`   | GlobeNewswire public-company releases                                 |
| `federal-reserve` | Federal Reserve press releases                                        |
| `sec-press`       | SEC newsroom press releases                                           |
| `ffiec`           | FFIEC press releases and announcements                                |
| `fdic`            | FDIC press releases and board meeting notices                         |
| `occ`             | OCC news releases and bulletins                                       |
| `cfpb`            | CFPB newsroom announcements                                           |
| `coindesk`        | CoinDesk                                                              |
| `cointelegraph`   | Cointelegraph                                                         |
| `benzinga`        | Benzinga                                                              |
| `investing-com`   | Investing.com stock market news                                       |
| `upi`             | UPI business news                                                     |
| `oilprice`        | OilPrice.com                                                          |
| `nyt`             | The New York Times business, economy, DealBook                        |
| `bbc`             | BBC News business                                                     |
| `npr`             | NPR business                                                          |
| `guardian`        | The Guardian business                                                 |
| `ft`              | Financial Times headlines                                             |
| `economist`       | The Economist finance & economics, business                           |
| `fortune`         | Fortune                                                               |
| `forbes`          | Forbes business                                                       |
| `washington-post` | The Washington Post business                                          |

The full registry, including exact feed URLs, is exported as `FIXED_FEEDS`; membership can be checked with `isFixedFeedProvider`. Sources excluded on purpose: endpoints requiring paid plans or registered API keys (NewsAPI, Finnhub, Marketaux, Guardian/NYT developer APIs, Benzinga API), dead or stub feeds (Business Wire public RSS, CNN Money, Motley Fool foolwatch, NCUA — no public RSS feed on the redesigned site), and endpoints that block non-browser clients (OTC Markets, AccessWire, Newsfile, Investegate, Barron's).

### Central-bank news and research feeds

The fixed registry also includes 29 central-bank news/speech feeds and 13 research feeds. Every one is opt-in and fetched whole before subject filtering. Use the exported groups to select the entire lane, or pass institution IDs directly:

```ts
import {
  CENTRAL_BANK_NEWS_PROVIDERS,
  CENTRAL_BANK_RESEARCH_PROVIDERS,
  buildTopicNewsFeed,
} from "@xbbg/xnews";

const allCentralBanks = await buildTopicNewsFeed({
  query: "inflation",
  sources: [...CENTRAL_BANK_NEWS_PROVIDERS, ...CENTRAL_BANK_RESEARCH_PROVIDERS],
  limit: 100,
});

const selectedInstitutions = await buildTopicNewsFeed({
  query: "financial stability",
  sources: ["ecb-news", "bank-england-news", "fed-board-research", "bank-canada-research"],
  limit: 25,
});
```

| Group                                | Provider IDs                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| News/speeches — Americas             | `bcb-news`, `bank-canada-news`, `atlanta-fed-news`, `richmond-fed-news`, `dallas-fed-news`                                                                                                                                                                   |
| News/speeches — Asia-Pacific         | `boj-news`, `bok-news`, `rbi-news`, `bsp-news`, `hkma-news`, `rba-news`, `rbnz-news`                                                                                                                                                                         |
| News/speeches — Europe               | `banco-de-espana-news`, `banca-ditalia-news`, `dnb-news`, `central-bank-ireland-news`, `cnb-news`, `mnb-news`, `tcmb-news`, `norges-bank-news`, `riksbank-news`, `central-bank-iceland-news`, `ecb-news`, `bank-england-news`, `bundesbank-news`, `snb-news` |
| News/speeches — Africa/international | `sarb-news`, `bis-press`, `bis-speeches`                                                                                                                                                                                                                     |
| Research — Americas                  | `fed-board-research`, `bcb-research`, `bank-canada-research`                                                                                                                                                                                                 |
| Research — Asia-Pacific              | `bok-research`, `hkma-research`, `rba-research`                                                                                                                                                                                                              |
| Research — Europe                    | `ecb-research`, `bundesbank-research`, `norges-bank-research`, `snb-research`, `banco-de-espana-research`, `banca-ditalia-research`, `dnb-research`                                                                                                          |

`FIXED_FEEDS` provides each provider's label, URL, `kind`, source name, and suggested minimum polling interval. Registry access grants endpoint access only; follow each linked publisher's terms before reproducing full content.

### Earnings call transcripts (`hf-transcripts`)

Company feeds can opt in to full earnings-call transcripts served keylessly from the
Hugging Face datasets-server. Each item links to the dataset viewer row and carries the
call's opening remarks as its summary; the dedicated fetchers return the complete text
and speaker-attributed turns:

```ts
import { fetchEarningsCallTranscripts, fetchEarningsCallTranscriptNews } from "@xbbg/xnews";

const [latest] = await fetchEarningsCallTranscripts("MSFT", { limit: 1 });
console.log(latest.year, latest.quarter, latest.publishedAt); // fiscal labels from the dataset
console.log(latest.turns[0]); // { speaker, text }
console.log(latest.content.length); // full transcript as one string (~50 KB)

const items = await fetchEarningsCallTranscriptNews("NVDA", { limit: 4 }); // NewsItem[]
```

The upstream dataset is a periodically republished snapshot, not a live wire: new
quarters appear when the dataset is refreshed, and rows label fiscal years/quarters as
the company reports them. Coverage is roughly 685 US large-cap issuers — much of, but
not all of, the S&P 500 — so absent names (RGA, for example) report `"empty"` rather
than failing. `year`/`quarter` options narrow to one call; pages cap at 100
rows (`HF_MAX_PAGE_LENGTH`) and default to the 8 newest. The generic builders
`hfDatasetRowsUrl`, `hfDatasetFilterUrl`, and `hfDatasetSearchUrl` reach any public
dataset served by datasets-server, and are also exported network-free from
`@xbbg/xnews/catalog`. Dataset text is MIT-licensed; transcripts remain the underlying
calls' editorial content, so review rights before republishing full text.

When the snapshot lags or lacks a name, `fetchAlphaVantageTranscript` fetches one
fiscal quarter's transcript from Alpha Vantage's `EARNINGS_CALL_TRANSCRIPT` endpoint —
opt-in with a free API key, following the same keyed pattern as `openalex`. Turns are
speaker-attributed with roles and upstream per-turn sentiment; free keys allow 25
requests per day at 5 per minute, and the key is redacted from reported URLs:

```ts
import { fetchAlphaVantageTranscript } from "@xbbg/xnews";

const call = await fetchAlphaVantageTranscript("IBM", "2024Q1", {
  apiKey: process.env.ALPHAVANTAGE_API_KEY!,
});
console.log(call.turns[1]); // { speaker, title, content, sentiment }
console.log(call.text.length); // full transcript as one string
```

For commentary beyond earnings calls, `SEC_COMMENTARY_QUERIES` curates EDGAR full-text
queries (prepared remarks, furnished transcripts, fireside chats, investor days —
routinely attached to 8-Ks under Reg FD) for `fetchSecFullTextFilings`, and
`COMPANY_COMMENTARY_YOUTUBE_CHANNELS` curates channels where executives speak in their
own words for `fetchYoutubeSubscriptions`.

### Channel feeds (YouTube)

The `youtube` provider is channel-based rather than subject-based: it does not participate in company/topic feeds (requesting it there reports `"unsupported"`) and is instead consumed through the subscription API below.

Run `bun run smoke:sources` to check every provider against the live endpoints.

## General subject API

```ts
import { buildNewsFeedResult } from "@xbbg/xnews";

const company = await buildNewsFeedResult({
  subject: { kind: "company", ticker: "RGA", companyName: "Reinsurance Group of America" },
  since: "2026-06-01T00:00:00.000Z",
  until: "2026-07-01T00:00:00.000Z",
});

const topic = await buildNewsFeedResult({
  subject: { kind: "topic", query: "preferred stock offerings" },
});
```

Supported subject kinds are `"company"` and `"topic"`. Market-intelligence subjects such as macro, sector, fund, index, or region should be represented as `kind: "topic"` queries until a consuming application needs different provider behavior.

### Dates

`NewsItem.publishedAt` is an ISO 8601 UTC instant derived from `publishedAtText` by the versioned parser identified by `PUBLISHED_AT_PARSER_VERSION`. Store `publishedAtText` unchanged so dates can be re-derived after parser fixes.

Date windows are inclusive. When `since` or `until` is present, items with missing or unparseable dates are excluded fail-closed after fetching and before the final merged limit is applied. `ProviderResult.undatedExcluded` counts those items.

`eventKind` and `tags` are optional deterministic hints derived from titles, summaries, source names, forms, and URLs. They are not investment advice, sentiment, materiality scoring, or a substitute for provider diagnostics.

### Errors

Transport failures throw `XnewsFetchError` with a machine-readable `code`:

- `config`: required provider configuration is missing or invalid.
- `network`: the transport failed before returning a response.
- `http_status`: the upstream returned a non-success HTTP status.
- `timeout`: the request exceeded `timeoutMs`.
- `aborted`: the caller aborted the request.

Provider warnings and errors include the effective request URL after removing credentials and redacting sensitive query values. In feed results, `config` failures surface with provider status `"disabled"`.

Malformed or truncated upstream JSON/XML is a provider error, not an empty result, and response bytes are never copied into public diagnostics. Multi-URL fixed-feed providers return `partial` with the surviving items when only some endpoints fail. News watchers tolerate partial success but throw when every selected provider is unavailable, so an outage cannot look like a quiet feed.

### Item identity

`NewsItem.id` is derived from `provider|guid-or-link|title`. Provider-specific variants may use a stronger identifier; SEC uses the accession number when present. `NEWS_ITEM_ID_SCHEME_VERSION` versions this derivation.

## Watchlist feed

```ts
import { buildWatchlistNewsFeedResult } from "@xbbg/xnews";

const result = await buildWatchlistNewsFeedResult({
  subjects: [
    { kind: "company", ticker: "RGA", companyName: "Reinsurance Group of America" },
    { kind: "topic", query: "insurance regulation" },
  ],
  sources: ["google-news"],
  limit: 25,
});

console.log(result.subjects.length);
console.log(result.items.length);
```

A watchlist result includes per-subject `NewsFeedResult` values, one merged top-level `items` list, flattened provider rows, flattened warnings, and a top-level `partial` flag.

## Structured data releases (FRED, CFTC COT, FFIEC call reports, DTCC swaps)

News is one lane; scheduled structured data is another. A `DataSource` binds a provider dataset to its transport, `fetchDataRelease` wraps any source in the same non-throwing status taxonomy as `ProviderResult`, and `createDataReleaseWatcher` polls until a release with a new `asOf` date — or, for sequenced sources like DTCC intraday slices, a greater `sequence` — appears. Built-in sources cover FRED series, CFTC Commitments of Traders, FFIEC Call Reports, and DTCC swap dissemination.

### FRED economic observations (`fred`)

FRED is a structured-data source, not a `NewsProvider`, and never participates in company/topic feeds. Supply a FRED API key to the standalone observation API or bind a series to the generic data lane:

```ts
import { fetchDataRelease, fetchFredObservations, fredDataSource } from "@xbbg/xnews";

const observations = await fetchFredObservations("UNRATE", {
  apiKey: process.env.FRED_API_KEY!,
  observationStart: "2025-01-01",
  sortOrder: "desc",
  limit: 12,
});
for (const row of observations.items) {
  console.log(row.date, row.value); // missing FRED "." values are null
}

const source = fredDataSource("UNRATE", {
  apiKey: process.env.FRED_API_KEY!,
  sortOrder: "desc",
  limit: 12,
});
const result = await fetchDataRelease(source);
if (result.status === "ok") {
  console.log(result.release?.asOf, result.release?.rows);
}
```

Standalone exports also include `searchFredSeries`, `fetchFredSeries`, the three FRED URL builders, and pure JSON parsers. `fredDataSource` labels releases with the uppercased series ID, sets `asOf` to the newest returned observation date, and redacts the API key from `requestUrls`.

`FRED_PROVIDER_POLICY` records the service ceiling as 120 requests per minute (2 per second). Read and follow the [FRED API Terms of Use](https://fred.stlouisfed.org/docs/api/terms_of_use.html), including source-specific third-party restrictions and this required notice:

> This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.

### CFTC Commitments of Traders (`cftc-cot`)

```ts
import {
  cotDataSource,
  cotReleaseToNewsItems,
  createDataReleaseWatcher,
  fetchCotReport,
} from "@xbbg/xnews";

// Latest week of Traders in Financial Futures, two markets.
const release = await fetchCotReport("tff", { markets: ["ZN", "ES"] });
for (const row of release?.rows ?? []) {
  console.log(row.marketName, row.leveragedFunds.long - row.leveragedFunds.short);
}

// Watch for new weekly releases and bridge them into a news pipeline.
const source = cotDataSource("tff", { markets: ["ES"] });
for await (const result of createDataReleaseWatcher(source)) {
  if (result.status === "ok" && result.release) {
    const items = cotReleaseToNewsItems(result.release); // NewsItem[], kind "data"
  }
}
```

Report families are `legacy`, `disaggregated`, and `tff` — each futures-only by default or futures-and-options with `combined: true` — plus the combined-only `cit` supplemental. Rows are typed per family (`CotTffRow`, `CotLegacyRow`, `CotDisaggregatedRow`, `CotCitRow`) with per-category positions `{ long, short, spreading?, longChange?, … }` in contracts. Without `since`/`until` a fetch resolves the dataset's latest report week in one probe request and returns exactly that week; with a window it returns rows newest-first up to `limit` (default 5000, Socrata's 50000 ceiling). `markets` accepts preset symbols and aliases (`COT_MARKETS`: ES, NQ, YM, RTY, ZT, ZF, ZN, ZB, UB, VIX) or raw CFTC contract market codes.

Positions are stated as of Tuesday and normally published Friday 15:30 ET; `DataRelease.asOf` and each item's `reportDate` carry the Tuesday. Unauthenticated Socrata clients share an IP throttling pool — pass `appToken` for sustained polling (`PROVIDER_POLICIES["cftc-cot"]` records the details). Like `youtube`, the `cftc-cot` provider does not participate in company/topic feeds (requesting it reports `"unsupported"`); `cotReleaseToNewsItems` is the bridge. The network-free URL builders, dataset registry, column maps, and market presets are also exported from `@xbbg/xnews/catalog`.

### FFIEC call reports (`ffiec-cdr`)

The second built-in source is the FFIEC Central Data Repository's bulk data distribution — quarterly Call Report data for every U.S. bank, free and keyless. The CDR endpoint is a stateful ASP.NET page; xnews drives the full postback chain (session cookies, `__VIEWSTATE` threading, product/period/format selection) and parses the bulk TSV archives with a built-in dependency-free ZIP reader.

```ts
import { createDataReleaseWatcher, fetchFfiecCallReport, ffiecCallDataSource } from "@xbbg/xnews";

// One quarterly release, filtered to two banks' balance sheet and income statement.
const release = await fetchFfiecCallReport({
  rssdIds: [852218, 480228], // JPMorgan Chase Bank NA, Bank of America NA
  schedules: ["RC", "RI"],
});
// release.rows: one row per filer and schedule with MDRM item values;
// release.asOf is the reporting period end, release.updatedAt the CDR's
// "Call Updated" stamp.

// Watch for new quarters. The watcher passes its last asOf as ifNewerThan,
// so unchanged quarters cost one page probe instead of a ~6 MB download.
const source = ffiecCallDataSource({ rssdIds: [852218] });
for await (const result of createDataReleaseWatcher(source, { intervalMs: 6 * 60 * 60_000 })) {
  // result.release?.rows …
}
```

One caveat by design: the watcher and the `ifNewerThan` skip both key on the reporting period (`asOf`), not the CDR's "Call Updated" stamp — a late refile of an already-seen quarter moves `updatedAt` but is not re-yielded. When revisions matter, compare `fetchFfiecBulkPage().callUpdated` (one cheap GET) against your last release's `updatedAt` and refetch that quarter with `period` pinned.

Beyond the data lane, the whole CDR bulk catalog is reachable: `downloadFfiecBulkData({ product, period?, format? })` fetches any of the six bulk products (single-period call reports, the four-period subset, UBPR ratios/ranks/stats) in its TSV or XBRL format, `fetchFfiecReportingPeriods` lists the offered quarters, and the pure parsers `parseFfiecCallBundle`, `parseFfiecFourPeriodBundle`, and `parseFfiecUbprBundle` turn TSV archives into typed bundles (institutions, schedules, MDRM columns, filings). `ffiecReleaseToNewsItems` bridges a release into the news lane as a single `kind: "data"` item, next to the `ffiec` announcements feed. The network-free product registry, postback form builders, and period helpers live in `@xbbg/xnews/catalog`; `PROVIDER_POLICIES["ffiec-cdr"]` records the session-cookie requirement and archive sizes.

### DTCC swap dissemination (`dtcc-sdr`)

DTCC's Public Price Dissemination publishes real-time swap transaction reports from its CFTC and SEC swap data repositories — every credit, rates, equity, FX, and commodity swap subject to public dissemination, free and keyless. Data arrives two ways, and xnews models both: intraday **slices** (ZIP-of-CSV files published continuously, indexed by a JSON catalog covering the most recent days) and cumulative **end-of-day** files (one ZIP per business date, published in the evening US time).

```ts
import {
  createDataReleaseWatcher,
  dtccSliceDataSource,
  fetchDtccCumulativeEvents,
  fetchDtccSliceCatalog,
  fetchDtccSliceEvents,
} from "@xbbg/xnews";

// Newest published end-of-day file (walks back from today automatically).
const eod = await fetchDtccCumulativeEvents();
// eod.events: normalized trade events; eod.businessDate, eod.url

// Manual intraday consumption: catalog, then individual slices.
const catalog = await fetchDtccSliceCatalog({ agency: "cftc", assetClass: "credits" });
const events = await fetchDtccSliceEvents(catalog.at(-1)!);

// Tail the slice stream loss-lessly: each release is one slice, sequenced
// by its catalog sliceId; the watcher drains backlogs without sleeping.
const source = dtccSliceDataSource({ assetClass: "credits" });
for await (const result of createDataReleaseWatcher(source, { intervalMs: 60_000 })) {
  // result.release?.rows: DtccTradeEvent[]; result.release?.sequence: sliceId
}
```

Every `(agency, assetClass)` pair uses the same endpoint scheme — `agency` is `"cftc"` or `"sec"`, `assetClass` is `"credits"` (default), `"rates"`, `"equities"`, `"forex"`, or `"commodities"`. Events carry the identity, lifecycle, product, and price columns as typed fields (`disseminationId`, `lineageId`, `executionTimestamp`, `notionalAmountLeg1`, `spreadLeg1`, `price`, `uniqueProductIdentifier`, …) and the full 100+ column row verbatim in `raw`. Numeric-looking values stay strings: DTCC renders notionals with thousands separators and caps large trades with a trailing `+` (`"25,000,000+"`) under block-trade rules, so number parsing is the consumer's decision. `dtccCumulativeDataSource` binds the end-of-day stream to the same watcher machinery, and `dtccReleaseToNewsItems` bridges a release into the news lane as a single `kind: "data"` summary item. Like the other data providers, `dtcc-sdr` never participates in company/topic feeds. The slice catalog only retains the most recent days — anything older must come from the cumulative files (`PROVIDER_POLICIES["dtcc-sdr"]` records the details); the network-free URL builders and file-name parser live in `@xbbg/xnews/catalog`, and the pure parsers (`parseDtccSliceCatalog`, `parseDtccTradeCsv`, `parseDtccTradeZip`) in `@xbbg/xnews/parsers`.

## Book catalogs (Open Library, Internet Archive, Library Genesis, Anna's Archive)

A third lane. News providers answer with dated documents and data providers with dated rows; a **works** provider answers a _query_ with catalog records that carry no release date and have no natural time ordering, so the works lane has its own machinery: `WorksSource`, `searchWorks`, `searchWorksAcross`, and `mergeWorkRecords`.

```ts
import { openLibrarySource, internetArchiveSource, searchWorksAcross } from "@xbbg/xnews";

const { items, results } = await searchWorksAcross([openLibrarySource(), internetArchiveSource()], {
  title: "Dune Messiah",
  author: "Herbert",
  limit: 10,
});
// items: WorkRecord[] merged and deduped across catalogs
// results: one non-throwing WorksResult envelope per catalog
```

Records deduplicate on the strongest shared identifier — ISBN-13, then DOI, then content MD5 — falling back to a normalized title/author/year/format key. `resolveWorkIdentity` recovers identifiers for a record that states none by scoring it against an authoritative catalog:

```ts
import { resolveWorkIdentity, openLibrarySource } from "@xbbg/xnews";

const resolution = await resolveWorkIdentity(scrapedRecord, openLibrarySource());
// resolution.identity.origin === "resolved"; check .confidence before trusting it
```

`availability` reports the catalog's access signal and defaults to `"unknown"` when the catalog states no availability metadata.

`WORKS_PROVIDER_POLICIES` records what each catalog requires before you schedule it: Open Library asks for a declared User-Agent, the Internet Archive publishes no numeric rate ceiling and marks lending items borrowable rather than redistributable, and the mirror-based catalogs publish no terms or uptime contract at all.

### Mirror pools

`open-library` and `internet-archive` have stable official APIs and carry their own origin. `libgen` and `annas-archive` rotate domains faster than a release cycle, so every URL builder requires a caller-supplied origin.

Supply origins in bulk from a deployment-local list — see [`mirrors.example.txt`](mirrors.example.txt). `mirrors.local.txt` is gitignored; override the path with `XNEWS_MIRRORS_FILE`.

```text
[libgen]
https://your-mirror.example        # a trailing comment becomes the label
your-fallback.example              # a bare host is read as https://
```

```ts
import { loadMirrorList, mirrorBaseUrls, libgenSource, searchWorks } from "@xbbg/xnews";

const list = await loadMirrorList(); // or loadMirrorList("path/to/list.txt")
const source = libgenSource({ mirrors: mirrorBaseUrls(list, "libgen") });
const result = await searchWorks(source, { title: "Dune Messiah" });
```

Mirrors are tried in order and **only a failed request advances to the next one** — a mirror that legitimately matched nothing ends the search rather than being papered over by the next mirror's hits. Every mirror that failed first is named in `result.warnings`. An empty pool is reported as `status: "disabled"` with a `config` error, never as an empty catalog. `parseMirrorList` is pure and rejects non-HTTPS origins at parse time, because the transport refuses them at request time anyway.

### Downloading and reading files

`WorkRecord.url` is a detail page, not a file. Retrieval is two steps: `resolveWorkFiles` walks the provider's own indirection to produce candidate file URLs, and `downloadFile` fetches one. `downloadWork` does both and returns the first candidate that answers.

```ts
import { downloadWork, extractText, libgenSource, searchWorks } from "@xbbg/xnews";

const result = await searchWorks(libgenSource({ mirrors }), { title: "Dune Messiah" });
const file = await downloadWork(result.items[0]!);
// file.bytes: Uint8Array, file.fileName, file.contentType, file.sizeBytes

const book = await extractText(file);
// book.text: full body in spine order; book.sections: per-document, with titles
```

Bytes are never decoded as text, so any file type passes through intact. The response ceiling is raised to 2 GiB for downloads — the shared 32 MiB default rejects most scanned PDFs.

Per provider:

| Provider           | How a file is reached                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `libgen`           | `/ads.php?md5=…` mints a single-use `key` for `/get.php`, so the page is fetched first — the key is not derivable |
| `internet-archive` | `/metadata/<id>` lists every file; `/download/<id>/<name>` serves one. Restricted items answer `401`              |
| `annas-archive`    | `/fast_download/…` needs a membership key; pass `annasArchiveKey` to use the documented JSON API                  |
| `open-library`     | a catalog, not a file host — resolves to no files                                                                 |

Catalogs mint a token on their own host then redirect to a CDN, so downloads set `allowCrossOriginRedirects`. A redirect into a private network address is still refused.

### Text extraction

`extractText` decodes every format below with **no runtime dependency** — the package still has zero.

| Format            | How                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| EPUB              | it is a ZIP; the OPF spine gives reading order, which keeps chapters ordered and cover/nav files out of the body                                |
| PDF               | native decoder: object scan + `/ObjStm` expansion, Flate/ASCIIHex/ASCII85/RunLength filters, PNG predictors, text operators, `/ToUnicode` CMaps |
| MOBI / AZW / AZW3 | PalmDOC LZ77 out of the PDB container                                                                                                           |
| CBZ               | enumerates page images in natural order — a comic has no text layer                                                                             |
| TXT / HTML        | pass through                                                                                                                                    |
| DjVu              | native decoder: IFF walker, the Z′-Coder arithmetic decoder, and the BZZ codec (Burrows–Wheeler with a frequency-rotated MTF)                   |
| CBR               | **refused by name**; RAR needs a real decoder                                                                                                   |

The PDF decoder does not rasterize and does not guess. Measured on real files: arXiv 1706.03762 (`arxiv.org/pdf/1706.03762`, _Attention Is All You Need_) is 15 pages and 35,504 characters in about 100 ms; a 12.3 MB, 1,306-page copy of CLRS is 5,481,690 characters in about 3.4 s. Two of three sampled files carry 30+ object streams, so `/ObjStm` support is not optional in practice.

DjVu is implemented from the published DjVu Reference v3, not from djvulibre or djvu.js — both are GPL-2 and this package is Apache-2.0. Measured against the specification's own DjVu edition (`DjVu3Spec.djvu`, 462 KB): 71 pages and 155,747 characters in under 150 ms. Like a scanned PDF, a DjVu with no hidden text layer throws rather than returning nothing.

### OCR for scans

A scanned PDF has page images and no characters, so extraction has nothing to read and says so rather than returning `""`:

```
PDF has no text layer across 83 page(s); it is most likely a scan and needs OCR
```

Pass an `ocr` server to read those. Scanned pages are stored as `/DCTDecode` image XObjects whose stream bytes already _are_ a JPEG, so xnews extracts them directly — **no PDF renderer involved**:

```ts
const book = await extractText(file, {
  ocr: { baseUrl: "http://127.0.0.1:10000", model: "Unlimited-OCR" },
});
```

Defaults target [Baidu's Unlimited-OCR](https://github.com/baidu/Unlimited-OCR) — `temperature: 0`, `skip_special_tokens: false`, `image_mode` of `gundam` for one page and `base` for several, and its `<image>document parsing.` prompts. Serve it with the vLLM or SGLang recipe from that repo; both expose an OpenAI-compatible `/v1/chat/completions`, which is all this talks to. On SGLang, pass `customLogitProcessor` to enable the recipe's 35-gram repeat suppression; vLLM rejects that field, so it is omitted unless you set it.

Any OpenAI-compatible vision endpoint works — set `baseUrl` to `OPENROUTER_BASE_URL` and an `apiKey` to route through OpenRouter, though Unlimited-OCR itself is not served there. Pages are batched (`pagesPerRequest`, default 8) because a long book overruns a 32k context, and a failed batch is reported as a warning with its page range rather than silently shortening the book.

Run `bun run smoke:works` to exercise all four catalogs against their live upstreams; the mirror-based two are skipped, not failed, when no pool is configured.

## YouTube channel subscriptions

Follow a set of channels through YouTube's public per-channel Atom feeds — free and keyless, no Google account. Channels can be given as `UC…` IDs, channel URLs, or `@handles`; handles are resolved to canonical IDs by reading the channel page once.

```ts
import { fetchYoutubeSubscriptions, fetchYoutubeChannelVideos } from "@xbbg/xnews";

const subs = await fetchYoutubeSubscriptions(["@CNBCtelevision", "@YahooFinance"], {
  hideShorts: true, // fetch each channel's long-form uploads playlist instead
  limit: 50, // caps the merged feed, not each channel
});

console.log(subs.items.length); // merged videos, newest first, kind "video"
console.log(subs.partial); // true when any channel failed
for (const channel of subs.channels) {
  console.log(channel.channel, channel.channelId, channel.items.length, channel.error);
}

const one = await fetchYoutubeChannelVideos("UCrp_UI8XtuYfpiqluWLD7Lw", { limit: 5 });
```

Each upstream feed carries only the ~15 most recent uploads, so poll on an interval and merge with your own retention if you need history. Channels fail independently: one bad channel never breaks the batch. YouTube's feed endpoint intermittently returns 404 for every channel during certain hours; per-channel errors flag this so cached results can be kept until it recovers. `since`/`until` windows are enforced locally.

`COMPANY_COMMENTARY_YOUTUBE_CHANNELS` ships a verified starter pack of channels where
executives speak in their own words — CNBC Television, Bloomberg Television and
Podcasts, Yahoo Finance, the All-In Podcast, and NBIM's In Good Company CEO
interviews — ready to feed `fetchYoutubeSubscriptions` and pair with
`fetchYoutubeTranscript` below.

### Video transcripts

`fetchYoutubeTranscript` extracts the transcript of a video — for example any item returned by the subscription feed — through the video's advertised caption tracks, also keyless:

```ts
import { fetchYoutubeTranscript } from "@xbbg/xnews";

const transcript = await fetchYoutubeTranscript(subs.items[0].url, { languages: ["en"] });

console.log(transcript.languageCode, transcript.generated); // "en", true for auto-generated
console.log(transcript.segments[0]); // { text, startMs, durationMs }
console.log(transcript.text); // full transcript as one string
```

Tracks are listed via the InnerTube player API (whose caption URLs remain readable server-side) with the watch page as fallback, and both timedtext formats (`srv1` and `srv3`) are parsed. Track choice prefers exact language matches, then the same base language ("en" matches "en-US"), manual captions over auto-generated ones, then any available track. Videos without captions throw.

### Realtime audio transcription

When a video has no usable caption track, `transcribeYoutubeRealtime` can decode its audio through `yt-dlp` and FFmpeg and send 16 kHz mono PCM to either the bundled Moonshine sidecar or bounded OpenRouter transcription requests.

Moonshine runs locally and emits a `ready` status followed by genuine incremental `partial` and committed `final` events. Install `yt-dlp`, FFmpeg, Python, and `moonshine-voice` separately; xnews bundles the sidecar protocol worker, not those runtimes or model weights. `moonshine-voice` must be importable by the configured Python. For an isolated on-demand environment, set `command: "uv"` and `commandArgs: ["run", "--with", "moonshine-voice", "python"]`.

```ts
import { createMoonshineAsrBackend, transcribeYoutubeRealtime } from "@xbbg/xnews";

const backend = createMoonshineAsrBackend({
  modelArch: "medium-streaming",
  language: "en",
});

for await (const event of transcribeYoutubeRealtime(videoUrl, { backend })) {
  if (event.type === "status") console.log(event.state);
  if (event.type === "partial") updateLiveCaption(event);
  if (event.type === "final") persistTranscriptLine(event);
  if (event.type === "gap") markDiscontinuity(event);
}
```

OpenRouter is the lower-setup hosted alternative. It uploads overlapping, WAV-encoded windows and emits committed results after each request; it is near-live chunked transcription, not a persistent streaming connection. Reconcile results by `segmentId` and `revision`, and use `sequence` only for delivery order.

```ts
import { createOpenRouterAsrBackend, transcribeYoutubeRealtime } from "@xbbg/xnews";

const backend = createOpenRouterAsrBackend({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: "deepgram/nova-3",
  windowMs: 15_000,
  overlapMs: 2_000,
  // responseFormat: "verbose_json", // required when requesting timestamp granularities
});

for await (const event of transcribeYoutubeRealtime(videoUrl, { backend })) {
  if (event.type === "final") console.log(event.startMs, event.text);
}
```

Both backends also work with `transcribePcmStream` for an application-owned `AsyncIterable<Uint8Array>` of signed 16-bit little-endian PCM at 16 kHz, mono. Abort signals stop the decoder, worker, and pending requests. Live-source reconnects emit explicit `gap` events; finite videos do not reconnect at EOF. OpenRouter audio leaves the machine and incurs provider charges, while Moonshine keeps PCM local but consumes local CPU/GPU and downloads model weights on first use.

Every session emits one sequenced `ready` status before transcript events. Breaking out of either async iterator cancels the backend; YouTube cancellation waits for decoder shutdown and terminates descendant processes started by wrapper commands. Event and request queues are bounded, so slow consumers apply backpressure rather than allowing output to grow without limit. On terminal FFmpeg failures, already-decoded PCM is finalized before the error is thrown, preserving the valid transcript prefix.

The OpenRouter backend always sends credentials only to the official `https://openrouter.ai` origin. Its optional `responseFormat` is limited to `"json"` or `"verbose_json"`; `timestampGranularities` requires `"verbose_json"`. Injected `fetch` remains available for testing, metering, and transport policy without changing the credential destination.

## Transport

xnews never opens a connection except through `options.fetch`, which defaults to `globalThis.fetch`. All source traffic flows through one internal chokepoint. Headers added by xnews are visible in the `RequestInit` received by the injected fetch.

`SourceFetchOptions.redirect` defaults to `"follow"`. xnews follows at most ten hops itself and re-applies URL, SEC identity, and EMMA consent policy before each connection; the injected fetch therefore receives `redirect: "manual"` for every hop. `"manual"` and `"error"` refuse to follow. Follow mode rejects HTTPS downgrades, localhost and non-public literal-IP destinations, and cross-origin hops that would forward sensitive query values, credential headers, or a non-GET/HEAD body. Credential-free public HTTPS GET redirects remain supported. Consumers still own DNS resolution and address policy: inject a governed transport for DNS pinning, robots policy, or rate limits. Proxy-aware, retrying, metered, and test fetchers require no parser changes.

```ts
const result = await buildCompanyNewsFeedResult({
  ticker: "RGA",
  fetch: proxyAwareFetch,
  redirect: "follow",
  timeoutMs: 20_000,
  maxResponseBytes: 16 * 1024 * 1024,
  signal: abortController.signal,
});
```

`timeoutMs` covers the complete request and redirect chain. `signal` aborts pending fetches and watchers. Response bodies are capped at 32 MiB by default; `maxResponseBytes` can set a tighter or larger non-negative safe-integer ceiling for a known endpoint.

Decoding is bounded past the transport too, because DEFLATE expands by up to ~1032:1 and a payload that cleared the byte ceiling can still exhaust memory. A ZIP entry must inflate to exactly the size its central directory declares, an entry declaring more than `MAX_ZIP_UNCOMPRESSED_BYTES` (512 MiB per archive) is refused before any decompression, and an oversized PDF stream is recorded in `PdfText.warnings` rather than materialized.

## SEC user agent

`secUserAgent` is required for requests to `sec.gov` and its subdomains; the shared caller-supplied `userAgent` satisfies the requirement when `secUserAgent` is omitted. Values are trimmed and blank/control-character values fail before network I/O. Use a value that identifies the consuming app and a real contact:

```ts
await buildCompanyNewsFeedResult({
  ticker: "RGA",
  secForms: ["8-K", "10-Q"],
  secUserAgent: "myapp/1.0 ops@example.com",
});
```

## Source limitations

All providers are public web feeds and endpoints whose terms, availability, markup, URLs, and throttling behavior can change without notice. SEC EDGAR responses can vary by identifier, form, count, and user-agent policy. GDELT and TickerTick enforce per-IP rate limits; shared egress IPs can see `429` responses that surface as provider errors while other providers keep working.

Inspect `ProviderResult.status`, `warnings`, `requestUrls`, `fetchedAt`, `durationMs`, and `partial` before trusting a feed as complete. A successful package call can still be partial when one provider fails or is unsupported.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, the quality gate, and the
conventions for adding a source. Security issues follow [SECURITY.md](SECURITY.md) —
please do not open a public issue for a vulnerability.

## License

Apache-2.0. See [LICENSE](LICENSE).
