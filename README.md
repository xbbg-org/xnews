# xnews

Pure fetch/parse/normalize utilities for building company, topic, and watchlist market-news feeds from free public sources. The package does not persist data, schedule jobs, store state, score sentiment, or provide investment advice.

## Install

```sh
bun add @xbbg/xnews
```

The published package exports ESM from `dist/index.js` and TypeScript declarations from `dist/index.d.ts`.

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

## Source catalog

Company feeds default to `sec-edgar`, `yahoo-finance`, `google-news`, and `finviz`; topic feeds default to `google-news`. Every other provider is opt-in through `sources`. All providers are free, keyless, and public.

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

`since`/`until` date windows are forwarded upstream where the endpoint supports them (`gdelt`, `sec-fulltext`, `federal-register`, `courtlistener`) and always enforced locally after fetching. `msrb-emma` maps `since` onto EMMA's fixed posting windows: it fetches Today+Yesterday by default and widens to ThisWeek/LastWeek (EMMA's maximum lookback) when the window reaches further back.

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

The full registry, including exact feed URLs, is exported as `FIXED_FEEDS`; membership can be checked with `isFixedFeedProvider`. Sources excluded on purpose: endpoints requiring paid plans or registered API keys (NewsAPI, Finnhub, Marketaux, Guardian/NYT developer APIs, Benzinga API), dead or stub feeds (Business Wire public RSS, CNN Money, Motley Fool foolwatch), and endpoints that block non-browser clients (OTC Markets, AccessWire, Newsfile, Investegate, Barron's).

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

Date windows are inclusive. When `since` or `until` is present, items with missing or unparseable `publishedAt` are dropped after fetching and before the final merged limit is applied.

`eventKind` and `tags` are optional deterministic hints derived from titles, summaries, source names, forms, and URLs. They are not investment advice, sentiment, materiality scoring, or a substitute for provider diagnostics.

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

## Injected fetch, proxy, timeout, and abort

All providers use the injected `fetch` through `fetchText`. Consumers can pass proxy-aware, retrying, metered, or test fetchers without changing parser code.

```ts
const result = await buildCompanyNewsFeedResult({
  ticker: "RGA",
  fetch: proxyAwareFetch,
  timeoutMs: 20_000,
  signal: abortController.signal,
});
```

`timeoutMs` is enforced by the package around each HTTP request. `signal` aborts pending fetches and watchers.

## SEC user agent

SEC requests should pass a real `secUserAgent` identifying the consuming app and contact, for example:

```ts
await buildCompanyNewsFeedResult({
  ticker: "RGA",
  secForms: ["8-K", "10-Q"],
  secUserAgent: "my-app/1.0 ops@example.com",
});
```

The package keeps a default SEC user agent for compatibility, but production callers should provide their own.

## Source limitations

All providers are public web feeds and endpoints whose terms, availability, markup, URLs, and throttling behavior can change without notice. SEC EDGAR responses can vary by identifier, form, count, and user-agent policy. GDELT and TickerTick enforce per-IP rate limits; shared egress IPs can see `429` responses that surface as provider errors while other providers keep working.

Inspect `ProviderResult.status`, `warnings`, `requestUrls`, `fetchedAt`, `durationMs`, and `partial` before trusting a feed as complete. A successful package call can still be partial when one provider fails or is unsupported.
