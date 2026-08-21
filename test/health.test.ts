import { expect, test } from "bun:test";
import {
  cdcWastewaterDataSource,
  fetchDataRelease,
  hungerMapDataSource,
  parseCdcWastewater,
  parseHungerMapFoodSecurity,
  parseUnhcrDisplacement,
  quoteSoqlString,
  socrataResourceUrl,
  unhcrDataSource,
} from "../src/index.js";
import { fetchInputUrl } from "./fixtures.js";

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("socrataResourceUrl emits standard SoQL parameters and escapes literals", () => {
  const quotedName = quoteSoqlString("O'Brien");
  expect(quotedName).toBe("'O''Brien'");

  const url = new URL(
    socrataResourceUrl("https://example.invalid", "abcd-1234", {
      select: ["state", "percentile"],
      where: `state = ${quotedName}`,
      limit: 25,
    }),
  );
  expect(url.pathname).toBe("/resource/abcd-1234.json");
  expect(url.searchParams.get("$select")).toBe("state,percentile");
  expect(url.searchParams.get("$where")).toBe("state = 'O''Brien'");
  expect(url.searchParams.get("$limit")).toBe("25");
});

test("CDC wastewater parses numeric strings and releases the latest date", async () => {
  const fixture = JSON.stringify([
    {
      state: "Maryland",
      date_start: "2026-07-01",
      date_end: "2026-07-15",
      percentile: "81.5",
      ptc_15d: "-12",
      detect_prop_15d: "98.2",
    },
    {
      state: "Virginia",
      date_start: "2026-07-08",
      date_end: "2026-07-22",
      percentile: "not-a-number",
      ptc_15d: "4.5",
      detect_prop_15d: "",
    },
  ]);
  const rows = parseCdcWastewater(fixture);
  expect(rows[0]).toEqual({
    state: "Maryland",
    dateStart: "2026-07-01",
    dateEnd: "2026-07-15",
    percentile: 81.5,
    percentChange15d: -12,
    detectionProportion15d: 98.2,
  });
  expect(rows[1]).toEqual({
    state: "Virginia",
    dateStart: "2026-07-08",
    dateEnd: "2026-07-22",
    percentChange15d: 4.5,
  });

  let requestedUrl: string | undefined;
  const source = cdcWastewaterDataSource({
    fetch: async (input) => {
      requestedUrl = fetchInputUrl(input);
      return jsonResponse(fixture);
    },
  });
  const release = await source.fetchRelease();
  expect(release?.asOf).toBe("2026-07-22");
  expect(release?.rows).toEqual(rows);
  expect(new URL(requestedUrl ?? "").searchParams.get("$select")).toContain(
    "wwtp_jurisdiction AS state",
  );
});

test("UNHCR parses numeric strings, omits garbage, and uses annual year-end", async () => {
  const fixture = JSON.stringify({
    items: [
      {
        year: "2025",
        coo_name: "Example Origin",
        coo_iso: "ORG",
        coa_name: "Example Asylum",
        coa_iso: "ASY",
        refugees: "1200",
        asylum_seekers: "34",
        idps: "5678",
        oip: "6",
        stateless: "7",
        ooc: "8",
        hst: "9",
      },
      {
        year: "2025",
        coo_name: "Bad Count",
        coo_iso: "BAD",
        refugees: "garbage",
        asylum_seekers: "2",
        idps: "3",
        oip: "0",
        stateless: "0",
        ooc: "0",
        hst: "0",
      },
    ],
  });
  const rows = parseUnhcrDisplacement(fixture);
  expect(rows[0]).toEqual({
    year: 2025,
    originName: "Example Origin",
    originIso3: "ORG",
    asylumName: "Example Asylum",
    asylumIso3: "ASY",
    refugees: 1200,
    asylumSeekers: 34,
    idps: 5678,
    others: 30,
  });
  expect(rows[1]).not.toHaveProperty("refugees");
  expect(rows[1]?.asylumSeekers).toBe(2);

  let requestedUrl: string | undefined;
  const source = unhcrDataSource({
    year: 2025,
    fetch: async (input) => {
      requestedUrl = fetchInputUrl(input);
      return jsonResponse(fixture);
    },
  });
  const release = await source.fetchRelease();
  expect(release?.asOf).toBe("2025-12-31");
  expect(new URL(requestedUrl ?? "").searchParams.get("yearFrom")).toBe("2025");
  expect(new URL(requestedUrl ?? "").searchParams.get("coo_all")).toBe("true");
});

test("HungerMap traverses body.countries and uses the newest country date", async () => {
  const fixture = JSON.stringify({
    body: {
      countries: [
        {
          country: { id: 1, iso3: "AAA", name: "Alpha" },
          metrics: { fcs: { people: "150000", prevalence: "0.25" } },
          date: "2026-06-30",
        },
        {
          country: { id: 2, iso3: "BBB", name: "Beta" },
          metrics: { fcs: { people: 80000, prevalence: 0.1 } },
          date: "2026-07-31T00:00:00.000Z",
        },
      ],
    },
  });
  const rows = parseHungerMapFoodSecurity(fixture);
  expect(rows).toEqual([
    {
      countryIso3: "AAA",
      countryName: "Alpha",
      peopleInsufficientFood: 150000,
      prevalence: 0.25,
      asOfDate: "2026-06-30",
    },
    {
      countryIso3: "BBB",
      countryName: "Beta",
      peopleInsufficientFood: 80000,
      prevalence: 0.1,
      asOfDate: "2026-07-31",
    },
  ]);

  const authorizationHeaders: (string | null)[] = [];
  const source = hungerMapDataSource({
    apiKey: "test-wfp-token",
    fetch: async (_input, init) => {
      authorizationHeaders.push(new Headers(init?.headers).get("authorization"));
      return jsonResponse(fixture);
    },
  });
  const release = await source.fetchRelease();
  expect(authorizationHeaders).toEqual(["Bearer test-wfp-token"]);
  expect(release?.asOf).toBe("2026-07-31");
  expect(release?.rows).toEqual(rows);
});

test("HungerMap is disabled without the credential WFP now requires", async () => {
  let dialed = false;
  const result = await fetchDataRelease(
    hungerMapDataSource({
      fetch: async () => {
        dialed = true;
        return jsonResponse("{}");
      },
    }),
  );

  expect(result.status).toBe("disabled");
  expect(result.error?.code).toBe("config");
  expect(result.error?.message).toContain("withdrew anonymous access");
  expect(dialed).toBe(false);
});
