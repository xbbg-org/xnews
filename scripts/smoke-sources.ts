import {
  buildNewsFeedResult,
  FIXED_FEED_PROVIDERS,
  fetchYoutubeSubscriptions,
  fetchYoutubeTranscript,
  providerCapabilities,
} from "../src";
import type { NewsProvider, ProviderResult } from "../src";

const QUERY_PROVIDERS: readonly NewsProvider[] = [
  "yahoo-finance",
  "google-news",
  "sec-edgar",
  "finviz",
  "bing-news",
  "gdelt",
  "tickertick",
  "hacker-news",
  "yahoo-search",
  "sec-fulltext",
  "sec-current",
  "federal-register",
  "courtlistener",
  "msrb-emma",
  "nasdaq",
  "seeking-alpha",
];

const ALL_PROVIDERS: readonly NewsProvider[] = [...QUERY_PROVIDERS, ...FIXED_FEED_PROVIDERS];

function summarize(providers: readonly ProviderResult[]): void {
  console.table(
    providers.map(({ provider, status, itemCount, durationMs, warnings }) => ({
      provider,
      status,
      itemCount,
      durationMs,
      warnings: warnings.join("; ").slice(0, 90),
    })),
  );
}

const companyResult = await buildNewsFeedResult({
  subject: { kind: "company", ticker: "RGA", companyName: "Reinsurance Group of America" },
  sources: ALL_PROVIDERS,
  secUserAgent: "xnews smoke test contact@example.com",
  timeoutMs: 25_000,
});

console.log(`\n== company subject: ${companyResult.items.length} merged items`);
summarize(companyResult.providers);

const topicResult = await buildNewsFeedResult({
  subject: { kind: "topic", query: "inflation" },
  sources: ALL_PROVIDERS.filter((provider) => providerCapabilities(provider).includes("topic")),
  secUserAgent: "xnews smoke test contact@example.com",
  timeoutMs: 25_000,
});

console.log(`\n== topic subject: ${topicResult.items.length} merged items`);
summarize(topicResult.providers);

const failures = [...companyResult.providers, ...topicResult.providers].filter(
  (provider) => provider.status === "error" || provider.status === "unsupported",
);
if (failures.length > 0) {
  console.log(`\n${failures.length} provider run(s) did not succeed:`);
  for (const failure of failures) {
    console.log(`- ${failure.provider}: ${failure.warnings.join("; ")}`);
  }
  process.exitCode = 1;
}

const subscriptions = await fetchYoutubeSubscriptions(["@CNBCtelevision", "@YahooFinance"], {
  hideShorts: true,
  timeoutMs: 25_000,
});

console.log(`\n== youtube subscriptions: ${subscriptions.items.length} merged videos`);
console.table(
  subscriptions.channels.map(({ channel, channelId, items, error }) => ({
    channel,
    channelId,
    itemCount: items.length,
    error: error?.slice(0, 90) ?? "",
  })),
);

const newestVideo = subscriptions.items[0];
if (newestVideo) {
  try {
    const transcript = await fetchYoutubeTranscript(newestVideo.url, { timeoutMs: 25_000 });
    console.log(
      `transcript for ${newestVideo.url}: ${transcript.segments.length} segments, ` +
        `${transcript.text.length} chars (${transcript.languageCode}${transcript.generated ? ", auto-generated" : ""})`,
    );
  } catch (error) {
    // Not fatal: the newest video may simply have no captions yet.
    console.log(
      `transcript for ${newestVideo.url} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (subscriptions.partial) {
  console.log("\nyoutube subscription channel(s) failed:");
  for (const channel of subscriptions.channels) {
    if (channel.error) console.log(`- ${channel.channel}: ${channel.error}`);
  }
  process.exitCode = 1;
}
