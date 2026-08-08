import { expect, test } from "bun:test";
import {
  fetchHfDailyPapers,
  HF_DAILY_PAPERS_URL,
  hfDailyPapersUrl,
  parseHfDailyPapers,
} from "../src/sources/hfpapers.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const completeEntry = {
  paper: {
    id: "2608.01492",
    authors: [
      { _id: "author-1", name: "Ada Researcher", hidden: false },
      { _id: "author-2", name: "Ben Scientist", hidden: false, user: "ben" },
    ],
    publishedAt: "2026-08-05T17:42:19.123Z",
    submittedOnDailyAt: "2026-08-06T03:04:05Z",
    title: "  A   Complete\nDaily Paper  ",
    summary: "  A detailed\n  abstract of the work.  ",
    upvotes: 42,
    discussionId: "discussion-123",
  },
  publishedAt: "2026-08-06T08:30:00Z",
  title: "A Complete Daily Paper",
  thumbnail: "/papers/2608.01492/thumbnail",
  numComments: 7,
  submittedBy: { _id: "submitter-1", fullname: "Daily Submitter" },
};

const completeResponse = JSON.stringify([completeEntry]);

function entry(id: string, title: string): typeof completeEntry {
  return {
    ...completeEntry,
    paper: {
      ...completeEntry.paper,
      id,
      title,
    },
  };
}

test("builds default, limit, date, and combined daily-papers URLs", () => {
  expect(HF_DAILY_PAPERS_URL).toBe("https://huggingface.co/api/daily_papers");
  expect(hfDailyPapersUrl()).toBe("https://huggingface.co/api/daily_papers");
  expect(hfDailyPapersUrl({ limit: 3 })).toBe("https://huggingface.co/api/daily_papers?limit=3");
  expect(hfDailyPapersUrl({ date: "2026-08-06" })).toBe(
    "https://huggingface.co/api/daily_papers?date=2026-08-06",
  );
  expect(hfDailyPapersUrl({ date: "2026-08-06", limit: 2 })).toBe(
    "https://huggingface.co/api/daily_papers?date=2026-08-06&limit=2",
  );
});

test("rejects daily-paper dates that are not shaped as YYYY-MM-DD", () => {
  expect(() => hfDailyPapersUrl({ date: "2026-8-06" })).toThrow("date must use YYYY-MM-DD format");
  expect(() => hfDailyPapersUrl({ date: "2026-08-06T00:00:00Z" })).toThrow(
    "date must use YYYY-MM-DD format",
  );
});

test("maps every supported Hugging Face paper field and distinguishes paper publication from announcement", () => {
  const papers = parseHfDailyPapers(completeResponse);

  expect(papers).toEqual([
    {
      id: "hf-papers|2608.01492|A Complete Daily Paper",
      provider: "hf-papers",
      kind: "analysis",
      title: "A Complete Daily Paper",
      url: "https://huggingface.co/papers/2608.01492",
      canonicalUrl: "https://arxiv.org/abs/2608.01492",
      source: "Hugging Face Daily Papers",
      publishedAt: "2026-08-05T17:42:19.123Z",
      publishedAtText: "2026-08-05T17:42:19.123Z",
      summary: "A detailed abstract of the work.",
      research: {
        authors: ["Ada Researcher", "Ben Scientist"],
        series: "Hugging Face Daily Papers",
        externalId: "2608.01492",
        submittedAt: "2026-08-06T03:04:05.000Z",
        announcedAt: "2026-08-06T08:30:00.000Z",
        pdfUrl: "https://arxiv.org/pdf/2608.01492",
      },
    },
  ]);
});

test("skips entries without a valid paper and deduplicates by external id", () => {
  const duplicate = entry("2608.01492", "Duplicate title is ignored");
  const papers = parseHfDailyPapers(
    JSON.stringify([
      { publishedAt: "2026-08-06T00:00:00Z", title: "Entry without paper" },
      { paper: { id: "not-an-arxiv-id", title: "Invalid identifier" } },
      completeEntry,
      duplicate,
    ]),
  );

  expect(papers).toHaveLength(1);
  expect(papers[0]?.title).toBe("A Complete Daily Paper");
});

test("rejects non-JSON, non-array, and candidate-only invalid responses", () => {
  expect(() => parseHfDailyPapers("not JSON")).toThrow(
    "unexpected non-JSON Hugging Face daily papers response",
  );
  expect(() => parseHfDailyPapers(JSON.stringify({ papers: [] }))).toThrow(
    "unexpected Hugging Face daily papers response shape",
  );
  expect(() =>
    parseHfDailyPapers(
      JSON.stringify([{ publishedAt: "2026-08-06T00:00:00Z" }, { paper: { id: "2608.99999" } }]),
    ),
  ).toThrow("Hugging Face daily papers response contained no valid records");
  expect(parseHfDailyPapers("[]")).toEqual([]);
});

test("truncates at the normalized limit and returns immediately for parse limit zero", () => {
  const response = JSON.stringify([
    entry("2608.00001", "First paper"),
    entry("2608.00002", "Second paper"),
  ]);

  expect(parseHfDailyPapers(response, 1).map((paper) => paper.research.externalId)).toEqual([
    "2608.00001",
  ]);
  expect(parseHfDailyPapers("not JSON", 0)).toEqual([]);
});

test("uses the requested URL and custom user-agent with an injected fetch", async () => {
  let requestedUrl = "";
  const requestedUserAgents: (string | null)[] = [];
  const papers = await fetchHfDailyPapers({
    date: "2026-08-06",
    limit: 2,
    userAgent: "hfpapers-test-agent/1.0",
    fetch: async (input, init) => {
      requestedUrl = inputUrl(input);
      requestedUserAgents.push(new Headers(init?.headers).get("user-agent"));
      return new Response(completeResponse);
    },
  });

  expect(requestedUrl).toBe("https://huggingface.co/api/daily_papers?date=2026-08-06&limit=2");
  expect(requestedUserAgents).toEqual(["hfpapers-test-agent/1.0"]);
  expect(papers).toHaveLength(1);
});

test("short-circuits fetch before network I/O when limit is zero", async () => {
  let calls = 0;
  const papers = await fetchHfDailyPapers({
    limit: 0,
    fetch: async () => {
      calls += 1;
      return new Response(completeResponse);
    },
  });

  expect(calls).toBe(0);
  expect(papers).toEqual([]);
});
