import { expect, test } from "bun:test";
import {
  CROSSREF_MAX_ROWS,
  CROSSREF_WORKS_URL,
  crossrefWorksUrl,
  fetchCrossrefWorks,
  parseCrossrefWorks,
} from "../src/sources/crossref.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const completeWork = {
  DOI: "10.1234/Mixed.Case",
  URL: "http://dx.doi.org/10.1234/Mixed.Case",
  type: "journal-article",
  title: ["Liquidity <i>shocks</i> and market structure"],
  "container-title": ["Journal of Market Structure"],
  publisher: "Example Press",
  issue: "4",
  subject: ["Finance", "Economics", "Finance"],
  abstract: "<jats:p>We study &amp; document how liquidity shocks propagate.</jats:p>",
  author: [
    {
      given: "Ada",
      family: "Economist",
      affiliation: [{ name: "Policy Institute" }],
    },
    { given: "Ben", family: "Researcher", affiliation: [] },
  ],
  issued: { "date-parts": [[2026, 4, 3]] },
  created: { "date-time": "2026-04-01T08:00:00Z" },
  deposited: { "date-time": "2026-04-05T09:30:00Z" },
  license: [{ URL: "https://creativecommons.org/licenses/by/4.0/" }],
  link: [
    {
      URL: "https://publisher.example/works/liquidity.xml",
      "content-type": "application/xml",
    },
    {
      URL: "https://publisher.example/works/liquidity.pdf",
      "content-type": "application/pdf",
    },
  ],
};

function listBody(items: readonly unknown[], extras: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "ok",
    "message-type": "work-list",
    message: { items, "total-results": 54346, "next-cursor": "AoJ42", ...extras },
  });
}

test("crossrefWorksUrl carries query, filters, paging, and polite-pool identity", () => {
  const url = new URL(
    crossrefWorksUrl("market liquidity", {
      filters: {
        type: "journal-article",
        "from-pub-date": "2026-01-01",
        "container-title": ["Journal of Finance", "Review of Financial Studies"],
        "has-abstract": true,
      },
      sort: "published",
      order: "desc",
      select: ["DOI", "title", " container-title "],
      rows: 50,
      cursor: "*",
      mailto: "dev@xbbg.org",
    }),
  );
  expect(url.origin + url.pathname).toBe(CROSSREF_WORKS_URL);
  expect(url.searchParams.get("query")).toBe("market liquidity");
  expect(url.searchParams.get("filter")).toBe(
    "type:journal-article,from-pub-date:2026-01-01,container-title:Journal of Finance,container-title:Review of Financial Studies,has-abstract:true",
  );
  expect(url.searchParams.get("sort")).toBe("published");
  expect(url.searchParams.get("order")).toBe("desc");
  expect(url.searchParams.get("select")).toBe("DOI,title,container-title");
  expect(url.searchParams.get("rows")).toBe("50");
  expect(url.searchParams.get("cursor")).toBe("*");
  expect(url.searchParams.get("mailto")).toBe("dev@xbbg.org");
});

test("crossrefWorksUrl omits empty parameters and derives rows from limit", () => {
  const bare = new URL(crossrefWorksUrl("  "));
  expect([...bare.searchParams.keys()]).toEqual([]);

  const limited = new URL(crossrefWorksUrl("q", { limit: 7 }));
  expect(limited.searchParams.get("rows")).toBe("7");

  const clamped = new URL(crossrefWorksUrl("q", { rows: 5_000 }));
  expect(clamped.searchParams.get("rows")).toBe(String(CROSSREF_MAX_ROWS));
});

test("crossrefWorksUrl validates paging", () => {
  expect(() => crossrefWorksUrl("q", { rows: 0 })).toThrow(RangeError);
  expect(() => crossrefWorksUrl("q", { offset: -1 })).toThrow(RangeError);
  expect(() => crossrefWorksUrl("q", { offset: 10_001 })).toThrow(RangeError);
  expect(() => crossrefWorksUrl("q", { offset: 20, cursor: "*" })).toThrow(
    "Crossref rejects offset and cursor in the same request",
  );
});

test("parseCrossrefWorks maps a complete work", () => {
  const page = parseCrossrefWorks(listBody([completeWork]));
  expect(page.totalResults).toBe(54346);
  expect(page.nextCursor).toBe("AoJ42");
  expect(page.items).toHaveLength(1);

  const paper = page.items[0];
  if (!paper) throw new Error("expected one paper");
  expect(paper.provider).toBe("crossref");
  expect(paper.kind).toBe("analysis");
  expect(paper.title).toBe("Liquidity shocks and market structure");
  expect(paper.url).toBe("http://dx.doi.org/10.1234/Mixed.Case");
  expect(paper.canonicalUrl).toBe("https://doi.org/10.1234/mixed.case");
  expect(paper.source).toBe("Journal of Market Structure");
  expect(paper.publishedAt).toBe("2026-04-03T00:00:00.000Z");
  expect(paper.publishedAtText).toBe("2026-04-03");
  expect(paper.summary).toBe("We study & document how liquidity shocks propagate.");
  expect(paper.tags).toEqual(["journal-article", "Finance", "Economics"]);
  expect(paper.research).toEqual({
    externalId: "10.1234/mixed.case",
    doi: "10.1234/mixed.case",
    authors: ["Ada Economist", "Ben Researcher"],
    institution: "Policy Institute",
    series: "Journal of Market Structure",
    issue: "4",
    categories: ["Finance", "Economics"],
    announcedAt: "2026-04-01T08:00:00.000Z",
    updatedAt: "2026-04-05T09:30:00.000Z",
    pdfUrl: "https://publisher.example/works/liquidity.pdf",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  });
});

test("parseCrossrefWorks falls back to created date for partial issued dates", () => {
  const partial = {
    ...completeWork,
    issued: { "date-parts": [[2026, 4]] },
  };
  const paper = parseCrossrefWorks(listBody([partial])).items[0];
  if (!paper) throw new Error("expected one paper");
  expect(paper.publishedAt).toBe("2026-04-01T08:00:00.000Z");
  expect(paper.publishedAtText).toBe("2026-04");
});

test("parseCrossrefWorks skips invalid records and dedupes by DOI", () => {
  const page = parseCrossrefWorks(
    listBody([
      { title: ["No DOI"] },
      { DOI: "not-a-doi", title: ["Bad DOI"] },
      { DOI: "10.1234/mixed.case", title: ["   "] },
      completeWork,
      { ...completeWork, title: ["Duplicate via DOI"] },
    ]),
  );
  expect(page.items).toHaveLength(1);
});

test("parseCrossrefWorks throws when no record parses", () => {
  expect(() => parseCrossrefWorks(listBody([{ DOI: "10.1/x y" }]))).toThrow(
    "Crossref Works response contained no valid records",
  );
  expect(() => parseCrossrefWorks("<html>")).toThrow();
  expect(() => parseCrossrefWorks(JSON.stringify({ status: "ok" }))).toThrow(
    "unexpected Crossref Works response shape",
  );
});

test("parseCrossrefWorks applies limits", () => {
  const second = { ...completeWork, DOI: "10.1234/other" };
  expect(parseCrossrefWorks(listBody([completeWork, second]), 1).items).toHaveLength(1);
  expect(parseCrossrefWorks(listBody([completeWork]), 0).items).toHaveLength(0);
});

test("fetchCrossrefWorks requests the built URL and honors limit 0", async () => {
  const requests: string[] = [];
  const page = await fetchCrossrefWorks("liquidity", {
    filters: { type: "journal-article" },
    limit: 1,
    fetch: (input) => {
      requests.push(inputUrl(input));
      return Promise.resolve(new Response(listBody([completeWork])));
    },
  });
  expect(page.items).toHaveLength(1);
  expect(requests).toHaveLength(1);
  const requested = new URL(requests[0] ?? "");
  expect(requested.searchParams.get("query")).toBe("liquidity");
  expect(requested.searchParams.get("filter")).toBe("type:journal-article");
  expect(requested.searchParams.get("rows")).toBe("1");

  const skipped = await fetchCrossrefWorks("liquidity", {
    limit: 0,
    fetch: () => {
      throw new Error("must not fetch when limit is 0");
    },
  });
  expect(skipped.items).toHaveLength(0);
});
