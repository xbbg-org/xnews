import { buildCompanyNewsFeedResult } from "../src";

const result = await buildCompanyNewsFeedResult({
  ticker: "RGA",
  companyName: "Reinsurance Group of America",
  secForms: ["8-K"],
  secUserAgent: "xnews smoke test contact@example.com",
});

const providers = result.providers.map((provider) => ({
  provider: provider.provider,
  status: provider.status,
  itemCount: provider.itemCount,
  warnings: provider.warnings,
}));

console.log(
  JSON.stringify(
    {
      count: result.items.length,
      partial: result.partial,
      providers,
      warnings: result.warnings,
      sample: result.items.slice(0, 3),
    },
    null,
    2,
  ),
);

if (result.items.length === 0) {
  throw new Error("Expected RGA smoke feed to return at least one item");
}

if (!result.providers.some((provider) => provider.status === "ok" && provider.itemCount > 0)) {
  throw new Error("Expected at least one RGA smoke provider to succeed with items");
}
