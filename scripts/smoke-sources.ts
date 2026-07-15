import { buildNewsFeedResult, FIXED_FEED_PROVIDERS, providerCapabilities } from "../src";
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
  "federal-register",
  "courtlistener",
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
