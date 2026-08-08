import { expect, test } from "bun:test";
import {
  fetchSsrnPapers,
  parseSsrnPapers,
  resolveSsrnBindingId,
  SSRN_NETWORKS,
  ssrnPapersUrl,
} from "../src/sources/ssrn.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const completePaper = {
  abstract_type: " <b>Working Paper Series</b> ",
  publication_status: "UNDER REVIEW",
  is_paid: true,
  reference: "FEN Paper",
  page_count: 42,
  title: "<p>Market &amp; Policy&nbsp;Effects</p>",
  authors: [
    {
      id: 101,
      last_name: " Smith  ",
      first_name: " Jeffrey ",
      url: "https://papers.ssrn.com/author=101",
    },
    {
      id: 102,
      last_name: "Jones",
      first_name: "  Ana   María ",
      url: "https://papers.ssrn.com/author=102",
    },
  ],
  affiliations: ",  Example University,   Policy Lab ",
  id: 1234567,
  is_approved: true,
  approved_date: "08 Aug 2026",
  downloads: 900,
  downloads_last_month: 75,
  downloads_this_year: 500,
  url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1234567",
};

const completeResponse = JSON.stringify({ total: 1, papers: [completePaper] });

function paperWith(id: number, title: string): Record<string, unknown> {
  return {
    ...completePaper,
    id,
    title,
    url: `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${id}`,
  };
}

test("resolves named and numeric SSRN binding ids", () => {
  expect(SSRN_NETWORKS).toEqual({ fen: 203, arn: 204, ern: 205 });
  expect(resolveSsrnBindingId("fen")).toBe(203);
  expect(resolveSsrnBindingId("arn")).toBe(204);
  expect(resolveSsrnBindingId("ern")).toBe(205);
  expect(resolveSsrnBindingId(9876)).toBe(9876);
});

test("rejects unknown networks and invalid numeric binding ids with TypeError", () => {
  expect(() =>
    // @ts-expect-error -- exercises the runtime guard for untyped callers
    resolveSsrnBindingId("unknown"),
  ).toThrow(TypeError);
  expect(() => resolveSsrnBindingId(0)).toThrow(TypeError);
  expect(() => resolveSsrnBindingId(-3)).toThrow(TypeError);
  expect(() => resolveSsrnBindingId(2.5)).toThrow(TypeError);
});

test("builds default and filtered SSRN paper URLs", () => {
  expect(ssrnPapersUrl("fen")).toBe(
    "https://api.ssrn.com/content/v1/bindings/203/papers?index=0&count=50&sort=0",
  );
  expect(ssrnPapersUrl("arn", { index: 75, count: 25, sort: 1 })).toBe(
    "https://api.ssrn.com/content/v1/bindings/204/papers?index=75&count=25&sort=1",
  );
  expect(ssrnPapersUrl(9876, { index: 5, count: 10, sort: 2 })).toBe(
    "https://api.ssrn.com/content/v1/bindings/9876/papers?index=5&count=10&sort=2",
  );
});

test("parses and cleans every supported SSRN paper field", () => {
  expect(parseSsrnPapers(completeResponse)).toEqual([
    {
      id: "ssrn|1234567|Market & Policy Effects",
      provider: "ssrn",
      kind: "analysis",
      title: "Market & Policy Effects",
      url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1234567",
      canonicalUrl: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1234567",
      source: "SSRN",
      publishedAt: "2026-08-08T00:00:00.000Z",
      publishedAtText: "08 Aug 2026",
      research: {
        authors: ["Jeffrey Smith", "Ana María Jones"],
        institution: "Example University, Policy Lab",
        series: "Working Paper Series",
        externalId: "1234567",
        announcedAt: "2026-08-08T00:00:00.000Z",
      },
    },
  ]);
});

test("skips invalid records and deduplicates papers by SSRN id", () => {
  const result = parseSsrnPapers(
    JSON.stringify({
      papers: [
        null,
        { id: 44, title: "Missing URL" },
        { id: "not-numeric", title: "Wrong id type", url: "https://example.com/paper" },
        paperWith(44, "Valid paper"),
        paperWith(44, "Duplicate title should not win"),
      ],
    }),
  );

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: "ssrn|44|Valid paper",
    title: "Valid paper",
    research: { externalId: "44" },
  });
});

test("throws when a non-empty SSRN response has no valid records", () => {
  expect(() => parseSsrnPapers(JSON.stringify({ papers: [{}, null] }))).toThrow(
    "SSRN response contained no valid records",
  );
});

test("applies valid-record limits and returns immediately for a zero parse limit", () => {
  const body = JSON.stringify({ papers: [paperWith(1, "First"), paperWith(2, "Second")] });
  expect(parseSsrnPapers(body, 1).map((paper) => paper.research.externalId)).toEqual(["1"]);
  expect(parseSsrnPapers("not JSON", 0)).toEqual([]);
});

test("fetches through the injected transport, maps limit to count, and sends custom user agent", async () => {
  const requests: Array<{ readonly url: string; readonly userAgent: string }> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push({
      url: inputUrl(input),
      userAgent: new Headers(init?.headers).get("user-agent") ?? "",
    });
    return new Response(
      JSON.stringify({ papers: [paperWith(1, "First"), paperWith(2, "Second")] }),
    );
  };

  const papers = await fetchSsrnPapers("ern", {
    index: 10,
    limit: 2,
    sort: 1,
    userAgent: "xnews-ssrn-test/1.0",
    fetch,
  });

  expect(papers).toHaveLength(2);
  expect(requests).toEqual([
    {
      url: "https://api.ssrn.com/content/v1/bindings/205/papers?index=10&count=2&sort=1",
      userAgent: "xnews-ssrn-test/1.0",
    },
  ]);
});

test("an explicit count takes precedence over fetch limit while parsing still truncates", async () => {
  let requestedUrl = "";
  const papers = await fetchSsrnPapers(300, {
    count: 20,
    limit: 1,
    fetch: async (input) => {
      requestedUrl = inputUrl(input);
      return new Response(
        JSON.stringify({ papers: [paperWith(1, "First"), paperWith(2, "Second")] }),
      );
    },
  });

  expect(requestedUrl).toBe(
    "https://api.ssrn.com/content/v1/bindings/300/papers?index=0&count=20&sort=0",
  );
  expect(papers.map((paper) => paper.research.externalId)).toEqual(["1"]);
});

test("zero fetch limits short-circuit before network access", async () => {
  let calls = 0;
  const papers = await fetchSsrnPapers("fen", {
    limit: 0,
    fetch: async () => {
      calls += 1;
      return new Response(completeResponse);
    },
  });

  expect(papers).toEqual([]);
  expect(calls).toBe(0);
});
