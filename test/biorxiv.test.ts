import { expect, test } from "bun:test";
import {
  BIORXIV_API_ORIGIN,
  bioRxivDetailsUrl,
  fetchBioRxivPapers,
  parseBioRxivPapers,
} from "../src/sources/biorxiv.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const completeBioRxivRecord = {
  doi: "https://doi.org/10.1101/2026.08.01.123456",
  title: " Neural <em>circuits</em> &amp; behavior ",
  authors: "Smith, A.; Jones, B.",
  author_corresponding: "Alex Smith",
  author_corresponding_institution: "Example Neuroscience Institute",
  date: "2026-08-01",
  version: "2",
  type: "new",
  category: "neuroscience",
  jatsxml: "https://www.biorxiv.org/content/early/2026/08/01/2026.08.01.123456.source.xml",
  abstract: "<p>A detailed abstract.</p>",
  published: "10.1000/journal.123",
  server: "bioRxiv",
};

const completeMedRxivRecord = {
  doi: "DOI: 10.64898/2026.07.30.654321",
  title: "Clinical prediction across cohorts",
  authors: "Garcia, C.; Patel, D.",
  author_corresponding: "Carmen Garcia",
  author_corresponding_institution: "Example Medical School",
  date: "2026-07-30",
  version: "1",
  type: "new",
  category: "cardiovascular medicine",
  jatsxml: "https://www.medrxiv.org/content/early/2026/07/30/2026.07.30.654321.source.xml",
  abstract: "Prospective validation across three cohorts.",
  published: "NA",
  server: "medRxiv",
};

const completeResponse = JSON.stringify({
  messages: [
    {
      status: "ok",
      interval: "2026-07-30:2026-08-01",
      cursor: 0,
      count: 2,
      count_new_papers: "2",
      total: "2",
    },
  ],
  collection: [completeBioRxivRecord, completeMedRxivRecord],
});

test("builds bioRxiv details URLs for both servers and validates the window and cursor", () => {
  expect(BIORXIV_API_ORIGIN).toBe("https://api.biorxiv.org");
  expect(
    bioRxivDetailsUrl("biorxiv", {
      from: "2026-07-25",
      to: "2026-08-01",
    }),
  ).toBe("https://api.biorxiv.org/details/biorxiv/2026-07-25/2026-08-01/0/json");
  expect(
    bioRxivDetailsUrl("medrxiv", {
      from: "2026-07-25",
      to: "2026-08-01",
      cursor: 100,
    }),
  ).toBe("https://api.biorxiv.org/details/medrxiv/2026-07-25/2026-08-01/100/json");

  expect(() => bioRxivDetailsUrl("biorxiv", { from: "2026/07/25", to: "2026-08-01" })).toThrow(
    "from must use YYYY-MM-DD format",
  );
  expect(() => bioRxivDetailsUrl("biorxiv", { from: "2026-07-25", to: "August 1, 2026" })).toThrow(
    "to must use YYYY-MM-DD format",
  );
  expect(() => bioRxivDetailsUrl("biorxiv", { from: "2026-08-02", to: "2026-08-01" })).toThrow(
    "from must be before or equal to to",
  );
  expect(() =>
    bioRxivDetailsUrl("biorxiv", {
      from: "2026-07-25",
      to: "2026-08-01",
      cursor: -1,
    }),
  ).toThrow("cursor must be a non-negative integer");
  expect(() =>
    bioRxivDetailsUrl("biorxiv", {
      from: "2026-07-25",
      to: "2026-08-01",
      cursor: 1.5,
    }),
  ).toThrow("cursor must be a non-negative integer");
});

test("maps complete bioRxiv and medRxiv records", () => {
  expect(parseBioRxivPapers(completeResponse)).toEqual([
    {
      id: "biorxiv|10.1101/2026.08.01.123456v2|Neural circuits & behavior",
      provider: "biorxiv",
      kind: "analysis",
      title: "Neural circuits & behavior",
      url: "https://www.biorxiv.org/content/10.1101/2026.08.01.123456v2",
      canonicalUrl: "https://doi.org/10.1101/2026.08.01.123456",
      source: "bioRxiv",
      publishedAt: "2026-08-01T00:00:00.000Z",
      publishedAtText: "2026-08-01",
      summary: "A detailed abstract.",
      tags: ["neuroscience"],
      research: {
        authors: ["Smith, A.", "Jones, B."],
        institution: "Example Neuroscience Institute",
        series: "bioRxiv",
        doi: "10.1101/2026.08.01.123456",
        categories: ["neuroscience"],
        externalId: "10.1101/2026.08.01.123456v2",
        version: "2",
        submittedAt: "2026-08-01T00:00:00.000Z",
      },
    },
    {
      id: "medrxiv|10.64898/2026.07.30.654321v1|Clinical prediction across cohorts",
      provider: "medrxiv",
      kind: "analysis",
      title: "Clinical prediction across cohorts",
      url: "https://www.medrxiv.org/content/10.64898/2026.07.30.654321v1",
      canonicalUrl: "https://doi.org/10.64898/2026.07.30.654321",
      source: "medRxiv",
      publishedAt: "2026-07-30T00:00:00.000Z",
      publishedAtText: "2026-07-30",
      summary: "Prospective validation across three cohorts.",
      tags: ["cardiovascular medicine"],
      research: {
        authors: ["Garcia, C.", "Patel, D."],
        institution: "Example Medical School",
        series: "medRxiv",
        doi: "10.64898/2026.07.30.654321",
        categories: ["cardiovascular medicine"],
        externalId: "10.64898/2026.07.30.654321v1",
        version: "1",
        submittedAt: "2026-07-30T00:00:00.000Z",
      },
    },
  ]);
});

test("filters categories locally without case sensitivity", () => {
  expect(
    parseBioRxivPapers(completeResponse, { categories: ["  CARDIOVASCULAR MEDICINE  "] }),
  ).toEqual([
    expect.objectContaining({
      provider: "medrxiv",
      research: expect.objectContaining({ categories: ["cardiovascular medicine"] }),
    }),
  ]);
  expect(parseBioRxivPapers(completeResponse, { categories: ["immunology"] })).toEqual([]);
});

test("skips invalid records and deduplicates by external id", () => {
  const papers = parseBioRxivPapers(
    JSON.stringify({
      collection: [
        null,
        { ...completeBioRxivRecord, server: "unknown" },
        { ...completeBioRxivRecord, title: "   " },
        { ...completeBioRxivRecord, doi: "not-a-doi" },
        { ...completeBioRxivRecord, version: "latest" },
        completeBioRxivRecord,
        { ...completeBioRxivRecord, title: "Duplicate identity" },
      ],
    }),
  );

  expect(papers).toHaveLength(1);
  expect(papers[0]?.title).toBe("Neural circuits & behavior");
});

test("throws when candidate records contain no valid preprints", () => {
  expect(() =>
    parseBioRxivPapers(
      JSON.stringify({
        collection: [null, { title: "No DOI" }, { ...completeBioRxivRecord, server: "other" }],
      }),
    ),
  ).toThrow("bioRxiv details response contained no valid records");
});

test("applies limits and returns immediately for limit zero", async () => {
  expect(parseBioRxivPapers(completeResponse, { limit: 1 })).toEqual([
    expect.objectContaining({ provider: "biorxiv" }),
  ]);
  expect(parseBioRxivPapers("not JSON", { limit: 0 })).toEqual([]);

  let calls = 0;
  const papers = await fetchBioRxivPapers({
    limit: 0,
    fetch: async () => {
      calls += 1;
      return new Response(completeResponse);
    },
  });
  expect(papers).toEqual([]);
  expect(calls).toBe(0);
});

test("fetches the default seven-day window with injected transport and custom user-agent", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const papers = await fetchBioRxivPapers({
    server: "medrxiv",
    categories: ["CARDIOVASCULAR MEDICINE"],
    userAgent: "xnews-biorxiv-test/1.0 test@example.com",
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requestedUrl = inputUrl(input);
      requestedInit = init;
      return new Response(JSON.stringify({ collection: [completeMedRxivRecord] }));
    },
  });

  const requested = new URL(requestedUrl);
  const segments = requested.pathname.split("/");
  const from = segments[3];
  const to = segments[4];
  expect(requested.origin).toBe("https://api.biorxiv.org");
  expect(segments[1]).toBe("details");
  expect(segments[2]).toBe("medrxiv");
  expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((Date.parse(to!) - Date.parse(from!)) / (24 * 60 * 60 * 1_000)).toBe(7);
  expect(segments.slice(5)).toEqual(["0", "json"]);
  expect(new Headers(requestedInit?.headers).get("User-Agent")).toBe(
    "xnews-biorxiv-test/1.0 test@example.com",
  );
  expect(papers).toEqual([expect.objectContaining({ provider: "medrxiv" })]);
});
