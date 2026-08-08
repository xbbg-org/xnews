import { expect, test } from "bun:test";
import {
  buildCompanyNewsFeedResult,
  buildTopicNewsFeedResult,
  COMPANY_COMMENTARY_YOUTUBE_CHANNELS,
  earningsCallTranscriptToNewsItem,
  earningsTranscriptsFilterUrl,
  fetchEarningsCallTranscripts,
  HF_EARNINGS_TRANSCRIPTS_DATASET,
  hfDatasetFilterUrl,
  hfDatasetRowsUrl,
  hfDatasetSearchUrl,
  hfDatasetViewerUrl,
  isYoutubeChannelId,
  parseEarningsCallTranscripts,
  SEC_COMMENTARY_QUERIES,
  secFullTextSearchUrl,
} from "../src/index.js";

const hfFilterFixture = JSON.stringify({
  features: [
    { feature_idx: 0, name: "symbol", type: { dtype: "string", _type: "Value" } },
    { feature_idx: 4, name: "content", type: { dtype: "string", _type: "Value" } },
  ],
  rows: [
    {
      row_idx: 41,
      row: {
        symbol: "AAPL",
        quarter: 2,
        year: 2025,
        date: "2025-05-01 19:13:00",
        content:
          "Suhasini Chandramouli: Good afternoon, and welcome to the Apple Q2 Fiscal Year 2025 Earnings Conference Call. Tim Cook: Thank you.",
        structured_content: [
          {
            speaker: "Suhasini Chandramouli",
            text: "Good afternoon, and welcome to the Apple Q2 Fiscal Year 2025 Earnings Conference Call.",
          },
          { speaker: "Tim Cook", text: "Thank you." },
          { speaker: "", text: "orphaned text is dropped" },
        ],
        company_name: "Apple Inc.",
        company_id: 24937.0,
      },
      truncated_cells: [],
    },
    {
      row_idx: 40,
      row: {
        symbol: "aapl",
        quarter: 1,
        year: 2025,
        date: null,
        content: "Operator: Welcome to the call.",
        structured_content: null,
        company_name: null,
      },
      truncated_cells: [],
    },
    {
      row_idx: 39,
      // No symbol/year/quarter/content: skipped rather than throwing.
      row: { quarter: 4, date: "2024-10-31 21:00:00" },
      truncated_cells: [],
    },
  ],
  num_rows_total: 79,
});

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("builds earnings-transcript filter URLs with escaped clauses", () => {
  const url = new URL(earningsTranscriptsFilterUrl("aapl"));
  expect(url.origin).toBe("https://datasets-server.huggingface.co");
  expect(url.pathname).toBe("/filter");
  expect(url.searchParams.get("dataset")).toBe("kurry/sp500_earnings_transcripts");
  expect(url.searchParams.get("config")).toBe("default");
  expect(url.searchParams.get("split")).toBe("train");
  expect(url.searchParams.get("where")).toBe(`"symbol"='AAPL'`);
  expect(url.searchParams.get("orderby")).toBe(`"date" DESC`);
  expect(url.searchParams.get("length")).toBe("8");
  expect(url.searchParams.get("offset")).toBe("0");

  const narrowed = new URL(
    earningsTranscriptsFilterUrl("brk.b", { year: 2024, quarter: 3, limit: 500, offset: 10 }),
  );
  expect(narrowed.searchParams.get("where")).toBe(
    `"symbol"='BRK.B' AND "year"=2024 AND "quarter"=3`,
  );
  expect(narrowed.searchParams.get("length")).toBe("100");
  expect(narrowed.searchParams.get("offset")).toBe("10");

  expect(new URL(earningsTranscriptsFilterUrl("o'hare")).searchParams.get("where")).toBe(
    `"symbol"='O''HARE'`,
  );
  expect(() => earningsTranscriptsFilterUrl("  ")).toThrow(TypeError);
  expect(() => earningsTranscriptsFilterUrl("AAPL", { quarter: 5 })).toThrow(RangeError);
  expect(() => earningsTranscriptsFilterUrl("AAPL", { year: 24 })).toThrow(RangeError);
  expect(() => earningsTranscriptsFilterUrl("AAPL", { offset: -1 })).toThrow(RangeError);
});

test("builds generic datasets-server URLs with clamped paging", () => {
  const rows = new URL(hfDatasetRowsUrl({ dataset: "org/data" }, { offset: 5, length: 250 }));
  expect(rows.pathname).toBe("/rows");
  expect(rows.searchParams.get("dataset")).toBe("org/data");
  expect(rows.searchParams.get("length")).toBe("100");
  expect(rows.searchParams.get("offset")).toBe("5");

  const filter = new URL(
    hfDatasetFilterUrl({ dataset: "org/data", split: "test" }, { where: `"a"=1`, length: 2 }),
  );
  expect(filter.searchParams.get("where")).toBe(`"a"=1`);
  expect(filter.searchParams.get("split")).toBe("test");

  const search = new URL(hfDatasetSearchUrl({ dataset: "org/data" }, "guidance"));
  expect(search.pathname).toBe("/search");
  expect(search.searchParams.get("query")).toBe("guidance");
  expect(() => hfDatasetSearchUrl({ dataset: "org/data" }, "  ")).toThrow(TypeError);
  expect(() => hfDatasetRowsUrl({ dataset: " " })).toThrow(TypeError);

  expect(hfDatasetViewerUrl(HF_EARNINGS_TRANSCRIPTS_DATASET, 41)).toBe(
    "https://huggingface.co/datasets/kurry/sp500_earnings_transcripts/viewer/default/train?row=41",
  );
  expect(hfDatasetViewerUrl({ dataset: "org/data" })).toBe(
    "https://huggingface.co/datasets/org/data/viewer/default/train",
  );
});

test("parses datasets-server rows into transcripts and skips malformed rows", () => {
  const transcripts = parseEarningsCallTranscripts(hfFilterFixture);

  expect(transcripts).toHaveLength(2);
  expect(transcripts[0]).toMatchObject({
    symbol: "AAPL",
    companyName: "Apple Inc.",
    year: 2025,
    quarter: 2,
    publishedAtText: "2025-05-01 19:13:00",
    url: "https://huggingface.co/datasets/kurry/sp500_earnings_transcripts/viewer/default/train?row=41",
  });
  expect(transcripts[0]?.publishedAt).toBe("2025-05-01T19:13:00.000Z");
  expect(transcripts[0]?.turns).toEqual([
    {
      speaker: "Suhasini Chandramouli",
      text: "Good afternoon, and welcome to the Apple Q2 Fiscal Year 2025 Earnings Conference Call.",
    },
    { speaker: "Tim Cook", text: "Thank you." },
  ]);

  // Null dates and missing structured content degrade, never throw.
  expect(transcripts[1]).toMatchObject({ symbol: "AAPL", year: 2025, quarter: 1, turns: [] });
  expect(transcripts[1]?.publishedAt).toBeUndefined();

  expect(parseEarningsCallTranscripts(hfFilterFixture, { limit: 1 })).toHaveLength(1);
  expect(parseEarningsCallTranscripts(hfFilterFixture, { limit: 0 })).toHaveLength(0);
  expect(() => parseEarningsCallTranscripts(`{"error":"A query parameter is invalid"}`)).toThrow(
    /datasets-server request failed/,
  );
  expect(() => parseEarningsCallTranscripts("<html>")).toThrow(/non-JSON/);
});

test("bridges transcripts into news items with stable identity", () => {
  const [transcript] = parseEarningsCallTranscripts(hfFilterFixture);
  const item = earningsCallTranscriptToNewsItem(transcript!);

  expect(item).toMatchObject({
    id: "hf-transcripts|AAPL|2025Q2",
    provider: "hf-transcripts",
    kind: "article",
    title: "Apple Inc. (AAPL) Q2 2025 earnings call transcript",
    url: "https://huggingface.co/datasets/kurry/sp500_earnings_transcripts/viewer/default/train?row=41",
    source: "Hugging Face Datasets",
    ticker: "AAPL",
    companyName: "Apple Inc.",
    publishedAt: "2025-05-01T19:13:00.000Z",
    eventKind: "earnings",
  });
  expect(item.summary).toBe(
    "Good afternoon, and welcome to the Apple Q2 Fiscal Year 2025 Earnings Conference Call.",
  );

  const longOpening = {
    ...transcript!,
    turns: [{ speaker: "CEO", text: "x".repeat(400) }],
  };
  const truncated = earningsCallTranscriptToNewsItem(longOpening);
  expect(truncated.summary?.length).toBe(281);
  expect(truncated.summary?.endsWith("…")).toBe(true);
});

test("fetches transcripts through the injected fetch and honors limit 0", async () => {
  const urls: string[] = [];
  const stubFetch = async (input: RequestInfo | URL) => {
    urls.push(fetchInputUrl(input));
    return new Response(hfFilterFixture, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const transcripts = await fetchEarningsCallTranscripts("AAPL", { fetch: stubFetch, limit: 2 });
  expect(transcripts).toHaveLength(2);
  expect(urls).toHaveLength(1);
  expect(urls[0]).toBe(earningsTranscriptsFilterUrl("AAPL", { limit: 2 }));

  const none = await fetchEarningsCallTranscripts("AAPL", { fetch: stubFetch, limit: 0 });
  expect(none).toEqual([]);
  expect(urls).toHaveLength(1);
});

test("hf-transcripts participates in company feeds and rejects topics", async () => {
  const stubFetch = async () =>
    new Response(hfFilterFixture, {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const result = await buildCompanyNewsFeedResult({
    ticker: "AAPL",
    sources: ["hf-transcripts"],
    fetch: stubFetch,
  });
  const provider = result.providers.find((entry) => entry.provider === "hf-transcripts");
  expect(provider?.status).toBe("ok");
  expect(provider?.itemCount).toBe(2);
  expect(provider?.requestUrls[0]).toContain("datasets-server.huggingface.co/filter");
  expect(result.items.some((item) => item.id === "hf-transcripts|AAPL|2025Q2")).toBe(true);

  const topic = await buildTopicNewsFeedResult({
    query: "earnings guidance",
    sources: ["hf-transcripts"],
    fetch: stubFetch,
  });
  expect(topic.providers[0]?.status).toBe("unsupported");
});

test("commentary packs stay well-formed", () => {
  expect(COMPANY_COMMENTARY_YOUTUBE_CHANNELS.length).toBeGreaterThanOrEqual(5);
  const ids = new Set<string>();
  for (const channel of COMPANY_COMMENTARY_YOUTUBE_CHANNELS) {
    expect(isYoutubeChannelId(channel.channelId)).toBe(true);
    expect(channel.name.length).toBeGreaterThan(0);
    expect(channel.focus.length).toBeGreaterThan(0);
    ids.add(channel.channelId);
  }
  expect(ids.size).toBe(COMPANY_COMMENTARY_YOUTUBE_CHANNELS.length);

  expect(SEC_COMMENTARY_QUERIES.length).toBeGreaterThanOrEqual(4);
  for (const entry of SEC_COMMENTARY_QUERIES) {
    expect(entry.query.length).toBeGreaterThan(0);
    expect(entry.forms).toContain("8-K");
    const url = new URL(secFullTextSearchUrl(entry.query, { forms: entry.forms }));
    expect(url.searchParams.get("q")).toBe(`"${entry.query}"`);
    expect(url.searchParams.get("forms")).toBe(entry.forms.join(","));
  }
});
