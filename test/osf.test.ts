import { expect, test } from "bun:test";
import {
  fetchOsfPreprints,
  OSF_PREPRINTS_URL,
  osfPreprintsUrl,
  parseOsfPreprints,
} from "../src/sources/osf.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const completeRecord = {
  id: "pn47e_v3",
  type: "preprints",
  attributes: {
    date_created: "2026-08-08T13:27:31.254391",
    date_modified: "2026-08-08T16:20:18.666427",
    date_published: "2026-08-08T16:20:18.547398",
    original_publication_date: null,
    doi: "10.9999/Fallback.Article",
    title: "Collective Sexuality Frames",
    description: "  An exploratory <b>study</b> of organized events.\nWith evidence. ",
    is_published: true,
    tags: ["CNM", " Germany ", "CNM"],
    version: 3,
    subjects: [
      [
        { id: "subject-1", text: "Social and Behavioral Sciences" },
        { id: "subject-2", text: "Leisure Studies" },
      ],
      [
        { id: "subject-1", text: "Social and Behavioral Sciences" },
        { id: "subject-3", text: "Sociology" },
        { id: "subject-4", text: "Sexualities" },
      ],
    ],
  },
  relationships: {
    provider: {
      data: { id: "socarxiv", type: "preprint-providers" },
    },
  },
  links: {
    self: "https://api.osf.io/v2/preprints/pn47e_v3/",
    html: "https://osf.io/preprints/socarxiv/pn47e_v3/",
    preprint_doi: "https://doi.org/10.31235/OSF.IO/PN47E_V3",
  },
};

const completeResponse = JSON.stringify({
  data: [completeRecord],
  links: {
    next: "https://api.osf.io/v2/preprints/?page=2&page%5Bsize%5D=2",
  },
  meta: { version: "2.0" },
});

test("builds default and fully filtered OSF preprint URLs", () => {
  expect(osfPreprintsUrl()).toBe(`${OSF_PREPRINTS_URL}?sort=-date_published`);
  expect(
    osfPreprintsUrl({
      providers: ["socarxiv", " psyarxiv "],
      pageSize: 2,
      sort: "date_published",
      publishedSince: "2026-08-01",
      publishedUntil: "2026-08-08",
    }),
  ).toBe(
    `${OSF_PREPRINTS_URL}?filter%5Bprovider%5D=socarxiv%2Cpsyarxiv&page%5Bsize%5D=2&sort=date_published&filter%5Bdate_published%5D%5Bgte%5D=2026-08-01&filter%5Bdate_published%5D%5Blte%5D=2026-08-08`,
  );
});

test("accepts only OSF page sizes from 1 through 100", () => {
  expect(new URL(osfPreprintsUrl({ pageSize: 1 })).searchParams.get("page[size]")).toBe("1");
  expect(new URL(osfPreprintsUrl({ pageSize: 100 })).searchParams.get("page[size]")).toBe("100");
  for (const pageSize of [0, 101, 1.5, Number.NaN]) {
    expect(() => osfPreprintsUrl({ pageSize })).toThrow(
      "pageSize must be an integer from 1 through 100",
    );
  }
});

test("parses a complete OSF preprint and JSON:API next link", () => {
  expect(parseOsfPreprints(completeResponse)).toEqual({
    items: [
      {
        id: "osf-preprints|pn47e_v3|Collective Sexuality Frames",
        provider: "osf-preprints",
        kind: "analysis",
        title: "Collective Sexuality Frames",
        url: "https://osf.io/preprints/socarxiv/pn47e_v3/",
        canonicalUrl: "https://doi.org/10.31235/osf.io/pn47e_v3",
        source: "socarxiv",
        publishedAt: "2026-08-08T16:20:18.547Z",
        publishedAtText: "2026-08-08T16:20:18.547398",
        summary: "An exploratory study of organized events. With evidence.",
        tags: ["CNM", "Germany"],
        research: {
          externalId: "pn47e_v3",
          series: "socarxiv",
          doi: "10.31235/osf.io/pn47e_v3",
          categories: [
            "Social and Behavioral Sciences",
            "Leisure Studies",
            "Sociology",
            "Sexualities",
          ],
          version: "3",
          submittedAt: "2026-08-08T13:27:31.254Z",
          updatedAt: "2026-08-08T16:20:18.666Z",
        },
      },
    ],
    nextUrl: "https://api.osf.io/v2/preprints/?page=2&page%5Bsize%5D=2",
  });
});

test("omits nextUrl and falls back to the article DOI and OSF source label", () => {
  const record = {
    ...completeRecord,
    id: "fallback_v1",
    attributes: {
      ...completeRecord.attributes,
      title: "Fallback DOI",
      doi: "DOI: 10.5555/Mixed.Case",
      version: 1,
    },
    relationships: {},
    links: {
      html: "https://osf.io/preprints/fallback_v1/",
    },
  };
  const page = parseOsfPreprints(JSON.stringify({ data: [record], links: { next: null } }));

  expect(page.nextUrl).toBeUndefined();
  expect(page.items[0]).toMatchObject({
    source: "OSF Preprints",
    canonicalUrl: "https://doi.org/10.5555/mixed.case",
    research: {
      externalId: "fallback_v1",
      doi: "10.5555/mixed.case",
      version: "1",
    },
  });
});

test("keeps absent OSF metadata fields absent on a minimal valid record", () => {
  expect(
    parseOsfPreprints(
      JSON.stringify({
        data: [
          {
            id: "minimal_v1",
            type: "preprints",
            attributes: { title: "Minimal preprint" },
            links: { html: "https://osf.io/preprints/minimal_v1/" },
          },
        ],
      }),
    ),
  ).toEqual({
    items: [
      {
        id: "osf-preprints|minimal_v1|Minimal preprint",
        provider: "osf-preprints",
        kind: "analysis",
        title: "Minimal preprint",
        url: "https://osf.io/preprints/minimal_v1/",
        canonicalUrl: "https://osf.io/preprints/minimal_v1/",
        source: "OSF Preprints",
        research: { externalId: "minimal_v1" },
      },
    ],
  });
});

test("skips invalid records and deduplicates one payload by external id", () => {
  const page = parseOsfPreprints(
    JSON.stringify({
      data: [
        null,
        { id: "missing-title_v1", type: "preprints", attributes: {}, links: {} },
        { ...completeRecord, type: "nodes" },
        completeRecord,
        {
          ...completeRecord,
          attributes: { ...completeRecord.attributes, title: "Duplicate title" },
        },
      ],
    }),
  );

  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.research.externalId).toBe("pn47e_v3");
});

test("throws when an OSF page contains candidates but no valid preprints", () => {
  expect(() =>
    parseOsfPreprints(
      JSON.stringify({
        data: [
          null,
          { id: "not-a-preprint", type: "nodes", attributes: {}, links: {} },
          { id: "missing-link_v1", type: "preprints", attributes: { title: "No link" } },
        ],
      }),
    ),
  ).toThrow("OSF Preprints response contained no valid records");
});

test("accepts empty pages and rejects invalid OSF response envelopes", () => {
  expect(parseOsfPreprints(JSON.stringify({ data: [] }))).toEqual({ items: [] });
  expect(() => parseOsfPreprints("not JSON")).toThrow("unexpected non-JSON OSF Preprints response");
  expect(() => parseOsfPreprints(JSON.stringify({ data: {} }))).toThrow(
    "unexpected OSF Preprints response shape",
  );
});

test("truncates parsed pages at the requested limit and handles limit zero", () => {
  const secondRecord = {
    ...completeRecord,
    id: "second_v1",
    attributes: { ...completeRecord.attributes, title: "Second preprint", version: 1 },
    links: {
      ...completeRecord.links,
      html: "https://osf.io/preprints/socarxiv/second_v1/",
      preprint_doi: "https://doi.org/10.31235/osf.io/second_v1",
    },
  };
  const limited = parseOsfPreprints(
    JSON.stringify({
      data: [completeRecord, secondRecord],
      links: { next: "https://example.test/2" },
    }),
    1,
  );

  expect(limited.items.map((item) => item.research.externalId)).toEqual(["pn47e_v3"]);
  expect(limited.nextUrl).toBe("https://example.test/2");
  expect(parseOsfPreprints("not JSON", 0)).toEqual({ items: [] });
});

test("fetches with injected transport, filters, limit-derived page size, and custom user-agent", async () => {
  let requestedUrl = "";
  const requestedUserAgents: (string | null)[] = [];
  const page = await fetchOsfPreprints({
    providers: ["socarxiv", "psyarxiv"],
    publishedSince: "2026-08-01",
    limit: 2,
    userAgent: "xnews-osf-test/1.0",
    fetch: async (input, init) => {
      requestedUrl = inputUrl(input);
      requestedUserAgents.push(new Headers(init?.headers).get("user-agent"));
      return new Response(completeResponse);
    },
  });

  expect(requestedUrl).toBe(
    `${OSF_PREPRINTS_URL}?filter%5Bprovider%5D=socarxiv%2Cpsyarxiv&page%5Bsize%5D=2&sort=-date_published&filter%5Bdate_published%5D%5Bgte%5D=2026-08-01`,
  );
  expect(requestedUserAgents).toEqual(["xnews-osf-test/1.0"]);
  expect(page.items).toHaveLength(1);
});

test("keeps an explicit page size when a separate result limit is present", async () => {
  let requestedUrl = "";
  await fetchOsfPreprints({
    pageSize: 7,
    limit: 2,
    fetch: async (input) => {
      requestedUrl = inputUrl(input);
      return new Response(JSON.stringify({ data: [] }));
    },
  });

  expect(requestedUrl).toBe(`${OSF_PREPRINTS_URL}?page%5Bsize%5D=7&sort=-date_published`);
});

test("returns an empty page for limit zero without calling fetch", async () => {
  let calls = 0;
  const page = await fetchOsfPreprints({
    limit: 0,
    fetch: async () => {
      calls += 1;
      return new Response(completeResponse);
    },
  });

  expect(calls).toBe(0);
  expect(page).toEqual({ items: [] });
});
