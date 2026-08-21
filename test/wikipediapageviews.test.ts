import { expect, test } from "bun:test";
import {
  WIKIPEDIA_EXCLUDED_PREFIXES,
  wikipediaPageviewsDate,
  wikipediaPageviewsUrl,
} from "../src/catalog.js";
import {
  fetchDataRelease,
  fetchWikipediaTopArticles,
  wikipediaPageviewsDataSource,
} from "../src/index.js";
import { parseWikipediaPageviews } from "../src/parsers.js";

const fixture = JSON.stringify({
  items: [
    {
      project: "en.wikipedia",
      access: "all-access",
      year: "2026",
      month: "01",
      day: "05",
      articles: [
        { article: "Main_Page", views: 5_000_000, rank: 1 },
        { article: "Special:Search", views: 4_000_000, rank: 2 },
        { article: "Wikipedia:Village_pump", views: 3_000_000, rank: 3 },
        { article: "2026_United_States_elections", views: 900_000, rank: 4 },
        { article: "Café_&_culture", views: 800_000, rank: 5 },
      ],
    },
  ],
});

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("wikipediaPageviewsUrl uses separate zero-padded date segments", () => {
  const url = wikipediaPageviewsUrl({ date: "2026-01-05" });
  expect(url).toBe(
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/" +
      "en.wikipedia/all-access/2026/01/05",
  );
  expect(url).not.toContain("/2026/1/5");
  expect(WIKIPEDIA_EXCLUDED_PREFIXES).toContain("Special:");
});

test("wikipediaPageviewsDate defaults to yesterday UTC", () => {
  const before = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const date = wikipediaPageviewsDate();
  const after = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  expect([before, after]).toContain(date);
});

test("parseWikipediaPageviews filters namespaces before applying limit", () => {
  const rows = parseWikipediaPageviews(fixture, { limit: 2 });
  expect(rows.map((row) => row.article)).toEqual([
    "2026_United_States_elections",
    "Café_&_culture",
  ]);
  expect(rows[0]).toEqual({
    article: "2026_United_States_elections",
    title: "2026 United States elections",
    views: 900_000,
    rank: 4,
    url: "https://en.wikipedia/wiki/2026_United_States_elections",
  });
  expect(rows[1]?.title).toBe("Café & culture");
  expect(rows[1]?.url).toBe("https://en.wikipedia/wiki/Caf%C3%A9_%26_culture");
});

test("parseWikipediaPageviews can include non-article pages", () => {
  const rows = parseWikipediaPageviews(fixture, { includeNonArticles: true });
  expect(rows.map((row) => row.article)).toEqual([
    "Main_Page",
    "Special:Search",
    "Wikipedia:Village_pump",
    "2026_United_States_elections",
    "Café_&_culture",
  ]);
});

test("fetchWikipediaTopArticles honors the requested release date", async () => {
  let requestedUrl: string | undefined;
  const rows = await fetchWikipediaTopArticles({
    date: "2026-01-05",
    limit: 1,
    fetch: async (input) => {
      requestedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return jsonResponse(fixture);
    },
  });

  expect(requestedUrl).toEndWith("/en.wikipedia/all-access/2026/01/05");
  expect(rows.map((row) => row.article)).toEqual(["2026_United_States_elections"]);
});

test("an unpublished 404 is empty, while a published empty day remains a release", async () => {
  const source = wikipediaPageviewsDataSource({ date: "2026-01-05" });
  expect(source.provider).toBe("wikipedia-pageviews");
  expect(source.dataset).toBe("top-articles");
  const unavailable = await fetchDataRelease(source, {
    fetch: async () => new Response("not published", { status: 404 }),
  });
  expect(unavailable.status).toBe("empty");
  expect(unavailable.release).toBeUndefined();

  const publishedEmpty = await fetchDataRelease(source, {
    fetch: async () =>
      jsonResponse(
        JSON.stringify({
          items: [
            {
              project: "en.wikipedia",
              access: "all-access",
              year: "2026",
              month: "01",
              day: "05",
              articles: [],
            },
          ],
        }),
      ),
  });
  expect(publishedEmpty.status).toBe("ok");
  expect(publishedEmpty.release?.provider).toBe("wikipedia-pageviews");
  expect(publishedEmpty.release?.dataset).toBe("top-articles");
  expect(publishedEmpty.release?.asOf).toBe("2026-01-05");
  expect(publishedEmpty.release?.rows).toEqual([]);

  expect(
    await fetchWikipediaTopArticles({
      date: "2026-01-05",
      fetch: async () => new Response(null, { status: 404 }),
    }),
  ).toEqual([]);
});

test("the default date falls back one day when yesterday is not yet published", async () => {
  const requestedUrls: string[] = [];
  const result = await fetchDataRelease(wikipediaPageviewsDataSource({ limit: 1 }), {
    fetch: async (input) => {
      requestedUrls.push(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      return requestedUrls.length === 1
        ? new Response("not published", { status: 404 })
        : jsonResponse(fixture);
    },
  });

  expect(result.status).toBe("ok");
  expect(requestedUrls).toHaveLength(2);
  const firstDate = requestedUrls[0]?.slice(-10).replaceAll("/", "-");
  const secondDate = requestedUrls[1]?.slice(-10).replaceAll("/", "-");
  if (!firstDate || !secondDate) throw new Error("expected two dated Wikimedia URLs");
  expect(Date.parse(`${firstDate}T00:00:00.000Z`) - Date.parse(`${secondDate}T00:00:00.000Z`)).toBe(
    86_400_000,
  );
  expect(result.release?.asOf).toBe(secondDate);
});
