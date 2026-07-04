import { buildCompanyNewsFeed, buildNewsFeedResult, createNewsWatcher } from "../src";

const feed = await buildCompanyNewsFeed({
  ticker: "RGA",
  companyName: "Reinsurance Group of America",
  secForms: ["8-K"],
  limit: 10,
});

console.table(
  feed.map((item) => ({
    provider: item.provider,
    source: item.source,
    date: item.publishedAt ?? item.publishedAtText ?? "",
    title: item.title,
    eventKind: item.eventKind ?? "",
    url: item.url,
  })),
);

const topic = await buildNewsFeedResult({
  subject: { kind: "topic", query: "insurance regulation" },
  limit: 5,
});

console.table(
  topic.providers.map((provider) => ({
    provider: provider.provider,
    status: provider.status,
    itemCount: provider.itemCount,
  })),
);

// Realtime = polling free feeds and yielding only unseen items.
// for await (const batch of createNewsWatcher({ ticker: "RGA", companyName: "Reinsurance Group of America", intervalMs: 60_000 })) {
//   console.log(batch);
// }
void createNewsWatcher;
