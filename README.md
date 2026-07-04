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

Topic feeds default to Google News only in this version. If unsupported providers are explicitly requested for a topic subject, those providers are not fetched and their `ProviderResult.status` is `"unsupported"` with a warning such as `"finviz: topic subjects are unsupported"`.

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

Yahoo Finance, Google News, and Finviz are public web/RSS sources whose terms, availability, markup, feeds, URLs, and throttling behavior can change without notice. SEC EDGAR responses can vary by identifier, form, count, and user-agent policy.

Inspect `ProviderResult.status`, `warnings`, `requestUrls`, `fetchedAt`, `durationMs`, and `partial` before trusting a feed as complete. A successful package call can still be partial when one provider fails or is unsupported.
