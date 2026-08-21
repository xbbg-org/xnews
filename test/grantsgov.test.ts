import { expect, test } from "bun:test";
import { grantsGovDataSource, parseGrantsGovOpportunities } from "../src/sources/grantsgov.js";
import { requestBodyText } from "./fixtures.js";

const opportunitiesPayload = JSON.stringify({
  data: {
    oppHits: [
      {
        id: "360001",
        number: "DE-FOA-000001",
        title: "Grid Resilience Research",
        agencyCode: "DOE",
        agency: "Department of Energy",
        openDate: "01/15/2026",
        closeDate: "03/31/2026",
        oppStatus: "posted",
      },
      {
        id: "360002",
        number: "DE-FOA-000002",
        title: "Malformed listing",
        agencyCode: "DOE",
        agency: "Department of Energy",
        openDate: "2026-01-16",
        closeDate: "03/31/2026",
        oppStatus: "posted",
      },
      {
        id: "360003",
        number: "NSF-26-101",
        title: "Advanced Manufacturing",
        agencyCode: "NSF",
        agency: "National Science Foundation",
        openDate: "02/20/2026",
        closeDate: "05/01/2026",
        oppStatus: "posted",
      },
    ],
  },
});

test("converts Grants.gov dates and skips malformed dates without throwing", () => {
  expect(parseGrantsGovOpportunities(opportunitiesPayload)).toEqual([
    {
      id: "360001",
      number: "DE-FOA-000001",
      title: "Grid Resilience Research",
      agencyCode: "DOE",
      agency: "Department of Energy",
      openDate: "2026-01-15",
      closeDate: "2026-03-31",
      oppStatus: "posted",
      url: "https://www.grants.gov/search-results-detail/360001",
    },
    {
      id: "360003",
      number: "NSF-26-101",
      title: "Advanced Manufacturing",
      agencyCode: "NSF",
      agency: "National Science Foundation",
      openDate: "2026-02-20",
      closeDate: "2026-05-01",
      oppStatus: "posted",
      url: "https://www.grants.gov/search-results-detail/360003",
    },
  ]);
});

test("rejects a structurally unrecognizable Grants.gov hits array", () => {
  expect(() => parseGrantsGovOpportunities(JSON.stringify({ data: { oppHits: [null] } }))).toThrow(
    "unexpected Grants.gov search response shape",
  );
  expect(() => parseGrantsGovOpportunities(JSON.stringify({ data: { oppHits: [{}] } }))).toThrow(
    "unexpected Grants.gov search response shape",
  );
});

test("uses the latest opportunity open date as the Grants.gov release date", async () => {
  const source = grantsGovDataSource({ keyword: "energy storage", limit: 25 });
  const release = await source.fetchRelease({
    fetch: async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(requestBodyText(init?.body))).toEqual({
        rows: 25,
        keyword: "energy storage",
        oppStatuses: "posted",
      });
      return new Response(opportunitiesPayload);
    },
  });

  expect(source.requestUrls()).toEqual(["https://api.grants.gov/v1/api/search2"]);
  expect(release).toMatchObject({
    provider: "grants-gov",
    dataset: "opportunities",
    asOf: "2026-02-20",
  });
  expect(release?.rows).toHaveLength(2);
});

test("falls back to today when Grants.gov publishes no parseable open date", async () => {
  const before = new Date().toISOString().slice(0, 10);
  const source = grantsGovDataSource();
  const release = await source.fetchRelease({
    fetch: async () =>
      new Response(
        JSON.stringify({
          data: {
            oppHits: [
              {
                id: "360004",
                number: "BAD-DATE",
                title: "Unparseable date",
                openDate: "not-a-date",
              },
            ],
          },
        }),
      ),
  });
  const after = new Date().toISOString().slice(0, 10);

  if (!release) throw new Error("expected a Grants.gov release");
  expect(release.rows).toEqual([]);
  expect([before, after]).toContain(release.asOf);
});
