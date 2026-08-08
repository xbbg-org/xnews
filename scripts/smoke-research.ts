/**
 * Live smoke for the research-paper lane: every standalone fetcher plus one
 * opt-in feed pass. Network-dependent; run with `bun run smoke:research`.
 */
import {
  buildTopicNewsFeedResult,
  fetchArxivPapers,
  fetchBioRxivPapers,
  fetchBisResearchHubRecent,
  fetchCrossrefWorks,
  fetchEuropePmcPapers,
  fetchHfDailyPapers,
  fetchNberRecentPapers,
  fetchNberWorkingPapers,
  fetchOsfPreprints,
  fetchSsrnPapers,
  fetchWorldBankDocuments,
} from "../src/index.js";
import type { ResearchPaper } from "../src/index.js";

const MAILTO = "dev@xbbg.org";
const failures: string[] = [];

async function smoke(label: string, run: () => Promise<readonly ResearchPaper[]>): Promise<void> {
  const startedAt = Date.now();
  try {
    const papers = await run();
    const first = papers[0];
    if (!first) {
      failures.push(`${label}: returned no papers`);
      console.log(`FAIL ${label}: empty result`);
      return;
    }
    const dated = papers.filter((paper) => paper.publishedAt).length;
    console.log(
      `ok   ${label}: ${papers.length} papers (${dated} dated, ${Date.now() - startedAt} ms) — ${first.title.slice(0, 72)}`,
    );
  } catch (error) {
    failures.push(`${label}: ${String(error)}`);
    console.log(`FAIL ${label}: ${String(error)}`);
  }
}

await smoke("arxiv", () => fetchArxivPapers('all:"monetary policy"', { limit: 3 }));
await smoke("bis-research-hub", () => fetchBisResearchHubRecent({ limit: 3 }));
await smoke("nber listing", () => fetchNberWorkingPapers({ q: "inflation", limit: 3 }));
await smoke("nber rss", () => fetchNberRecentPapers({ limit: 3 }));
await smoke("ssrn fen", () => fetchSsrnPapers("fen", { limit: 3 }));
await smoke("crossref", async () => {
  const page = await fetchCrossrefWorks("market liquidity", {
    filters: { type: "journal-article" },
    limit: 3,
    mailto: MAILTO,
  });
  return page.items;
});
await smoke("world-bank", () =>
  fetchWorldBankDocuments("inflation", {
    docTypes: ["Policy Research Working Paper"],
    limit: 3,
  }),
);
await smoke("europe-pmc", async () => {
  const page = await fetchEuropePmcPapers("glp-1 obesity", {
    resultType: "core",
    limit: 3,
  });
  return page.items;
});
await smoke("hf-papers", () => fetchHfDailyPapers({ limit: 3 }));
await smoke("osf-preprints", async () => {
  const page = await fetchOsfPreprints({ providers: ["socarxiv"], limit: 3 });
  return page.items;
});
await smoke("biorxiv", () =>
  fetchBioRxivPapers({ server: "biorxiv", limit: 3, timeoutMs: 90_000 }),
);
await smoke("medrxiv", () =>
  fetchBioRxivPapers({ server: "medrxiv", limit: 3, timeoutMs: 90_000 }),
);

const feed = await buildTopicNewsFeedResult({
  query: "inflation",
  sources: ["nber", "ssrn", "crossref", "world-bank", "europe-pmc", "hf-papers"],
  limit: 25,
});
console.log(`\n== research feed: ${feed.items.length} merged items`);
console.table(
  feed.providers.map(({ provider, status, items, durationMs }) => ({
    provider,
    status,
    items: items.length,
    ms: durationMs,
  })),
);
for (const provider of feed.providers) {
  if (provider.status === "error" || provider.status === "unsupported") {
    failures.push(`feed ${provider.provider}: ${provider.error?.message ?? provider.status}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} research smoke failure(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("\nresearch smoke passed");
