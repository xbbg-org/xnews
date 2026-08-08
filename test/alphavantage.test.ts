import { expect, test } from "bun:test";
import {
  alphaVantageTranscriptUrl,
  fetchAlphaVantageTranscript,
  parseAlphaVantageTranscript,
  XnewsFetchError,
} from "../src/index.js";

const alphaVantageFixture = JSON.stringify({
  symbol: "IBM",
  quarter: "2024Q1",
  transcript: [
    {
      speaker: "Olympia McNerney",
      title: "Global Head of Investor Relations",
      content:
        "Thank you. I'd like to welcome you to IBM's First Quarter 2024 Earnings Presentation.",
      sentiment: "0.6",
    },
    { speaker: "Arvind Krishna", title: "CEO", content: "Thanks Olympia.", sentiment: "n/a" },
    { speaker: "", content: "orphaned rows are dropped", sentiment: "0.1" },
  ],
});

test("builds Alpha Vantage transcript URLs and fails closed without a key", () => {
  const url = new URL(alphaVantageTranscriptUrl("ibm", "2024q1", { apiKey: "SECRET" }));
  expect(url.origin).toBe("https://www.alphavantage.co");
  expect(url.pathname).toBe("/query");
  expect(url.searchParams.get("function")).toBe("EARNINGS_CALL_TRANSCRIPT");
  expect(url.searchParams.get("symbol")).toBe("IBM");
  expect(url.searchParams.get("quarter")).toBe("2024Q1");
  expect(url.searchParams.get("apikey")).toBe("SECRET");

  expect(() => alphaVantageTranscriptUrl(" ", "2024Q1", { apiKey: "k" })).toThrow(TypeError);
  expect(() => alphaVantageTranscriptUrl("IBM", "2024", { apiKey: "k" })).toThrow(RangeError);
  expect(() => alphaVantageTranscriptUrl("IBM", "2024Q5", { apiKey: "k" })).toThrow(RangeError);

  let configError: unknown;
  try {
    alphaVantageTranscriptUrl("IBM", "2024Q1", { apiKey: "  " });
  } catch (error) {
    configError = error;
  }
  if (!(configError instanceof XnewsFetchError)) {
    throw new Error("Expected a config XnewsFetchError for a blank apiKey");
  }
  expect(configError.code).toBe("config");
});

test("parses transcripts with per-turn sentiment coercion", () => {
  const transcript = parseAlphaVantageTranscript(alphaVantageFixture);

  expect(transcript.symbol).toBe("IBM");
  expect(transcript.quarter).toBe("2024Q1");
  expect(transcript.turns).toHaveLength(2);
  expect(transcript.turns[0]).toEqual({
    speaker: "Olympia McNerney",
    title: "Global Head of Investor Relations",
    content:
      "Thank you. I'd like to welcome you to IBM's First Quarter 2024 Earnings Presentation.",
    sentiment: 0.6,
  });
  // Unparseable sentiment degrades to absence, never NaN.
  expect(transcript.turns[1]).toEqual({
    speaker: "Arvind Krishna",
    title: "CEO",
    content: "Thanks Olympia.",
  });
  expect(transcript.text).toBe(
    "Olympia McNerney: Thank you. I'd like to welcome you to IBM's First Quarter 2024 Earnings Presentation.\n\nArvind Krishna: Thanks Olympia.",
  );

  const empty = parseAlphaVantageTranscript(
    JSON.stringify({ symbol: "IBM", quarter: "2025Q9", transcript: [] }),
  );
  expect(empty.turns).toEqual([]);
  expect(empty.text).toBe("");

  expect(() =>
    parseAlphaVantageTranscript(JSON.stringify({ Information: "rate limit reached" })),
  ).toThrow(/rate limit reached/);
  expect(() =>
    parseAlphaVantageTranscript(JSON.stringify({ "Error Message": "Invalid API call" })),
  ).toThrow(/Invalid API call/);
  expect(() => parseAlphaVantageTranscript(JSON.stringify({ unexpected: true }))).toThrow(
    /unexpected Alpha Vantage response shape/,
  );
  expect(() => parseAlphaVantageTranscript("<html>")).toThrow(/non-JSON/);
  const reflectedSecret = "apikey=reflected-secret";
  try {
    parseAlphaVantageTranscript(JSON.stringify({ unexpected: reflectedSecret }));
    throw new Error("expected response-shape validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("expected response-shape validation to throw an Error", { cause: error });
    }
    expect(error.message).not.toContain(reflectedSecret);
  }
});

test("validates the Alpha Vantage transcript collection shape", () => {
  const response = { symbol: "IBM", quarter: "2024Q1" };

  expect(() => parseAlphaVantageTranscript(JSON.stringify(response))).toThrow(
    "unexpected Alpha Vantage response shape",
  );
  expect(() =>
    parseAlphaVantageTranscript(JSON.stringify({ ...response, transcript: {} })),
  ).toThrow("unexpected Alpha Vantage response shape");

  const empty = parseAlphaVantageTranscript(JSON.stringify({ ...response, transcript: [] }));
  expect(empty.turns).toEqual([]);
  expect(empty.text).toBe("");

  expect(() =>
    parseAlphaVantageTranscript(
      JSON.stringify({
        ...response,
        transcript: [null, "invalid", { speaker: "", content: "missing speaker" }],
      }),
    ),
  ).toThrow("unexpected Alpha Vantage response shape");

  const mixed = parseAlphaVantageTranscript(
    JSON.stringify({
      ...response,
      transcript: [
        null,
        { speaker: "Arvind Krishna", content: "Valid turn." },
        { speaker: "Missing content" },
      ],
    }),
  );
  expect(mixed.turns).toEqual([{ speaker: "Arvind Krishna", content: "Valid turn." }]);
  expect(mixed.text).toBe("Arvind Krishna: Valid turn.");
});

test("fetches transcripts through the injected fetch", async () => {
  const urls: string[] = [];
  const stubFetch = async (input: RequestInfo | URL) => {
    urls.push(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );
    return new Response(alphaVantageFixture, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const transcript = await fetchAlphaVantageTranscript("IBM", "2024Q1", {
    apiKey: "k",
    fetch: stubFetch,
  });
  expect(transcript.turns).toHaveLength(2);
  expect(urls[0]).toBe(alphaVantageTranscriptUrl("IBM", "2024Q1", { apiKey: "k" }));
});
