import { expect, test } from "bun:test";
import { YAHOO_FUTURES_SYMBOLS, yahooChartUrl } from "../src/catalog.js";
import { fetchYahooQuote, parseYahooChart } from "../src/index.js";
import { fetchInputUrl } from "./fixtures.js";

const chartFixture = JSON.stringify({
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          symbol: "CL=F",
          exchangeName: "NYM",
          regularMarketPrice: 82.4,
          chartPreviousClose: 80,
          regularMarketDayHigh: 83.1,
          regularMarketDayLow: 78.9,
          regularMarketVolume: 125_000,
          regularMarketTime: 1_720_172_800,
        },
        timestamp: [1_720_000_000, 1_720_086_400, 1_720_172_800, null],
        indicators: {
          quote: [
            {
              open: [79.5, null, 81.25, null],
              high: [81, null, 83.1, null],
              low: [78.9, null, 80.75, null],
              close: [80, null, 82.5, null],
              volume: [100_000, null, 125_000, null],
            },
          ],
          adjclose: [{ adjclose: [80, null, 82.5, null] }],
        },
      },
    ],
    error: null,
  },
});

test("Yahoo chart URLs encode futures and index symbols", () => {
  expect(yahooChartUrl("CL=F", { interval: "1d", range: "1mo", host: "query1" })).toBe(
    "https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=1d&range=1mo",
  );
  expect(yahooChartUrl("^VIX", { interval: "5m", range: "1d", host: "query2" })).toBe(
    "https://query2.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=5m&range=1d",
  );
  expect(YAHOO_FUTURES_SYMBOLS["CL=F"]).toBe("WTI crude oil futures");
});

test("Yahoo chart URLs reject unsupported intervals", () => {
  expect(() =>
    // The point of this test is the runtime guard, and TypeScript cannot
    // express passing a value its own union forbids without an assertion.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    yahooChartUrl("CL=F", { interval: "4h" as never, range: "1mo", host: "query1" }),
  ).toThrow(RangeError);
});

test("Yahoo chart parsing derives a quote from the last non-null close", () => {
  const result = parseYahooChart(chartFixture, "CL=F");

  expect(result.quote).toEqual({
    symbol: "CL=F",
    currency: "USD",
    exchangeName: "NYM",
    price: 82.5,
    previousClose: 80,
    change: 2.5,
    changePercent: 3.125,
    dayHigh: 83.1,
    dayLow: 78.9,
    volume: 125_000,
    marketTime: "2024-07-05T09:46:40.000Z",
  });
});

test("Yahoo chart parsing keeps null-padded bars and skips only bad timestamps", () => {
  const result = parseYahooChart(chartFixture, "CL=F");

  expect(result.bars).toHaveLength(3);
  expect(result.bars[1]).toEqual({ timestamp: "2024-07-04T09:46:40.000Z" });
  expect(result.bars[2]).toEqual({
    timestamp: "2024-07-05T09:46:40.000Z",
    open: 81.25,
    high: 83.1,
    low: 80.75,
    close: 82.5,
    volume: 125_000,
  });
});

test("a zero previous close omits derived change fields", () => {
  // Typed on the binding rather than asserted: `JSON.parse` returns `any`,
  // and an assertion from `any` hides a fixture-shape drift.
  const fixture: { chart: { result: [{ meta: { chartPreviousClose: number } }] } } =
    JSON.parse(chartFixture);
  fixture.chart.result[0].meta.chartPreviousClose = 0;

  const quote = parseYahooChart(JSON.stringify(fixture), "CL=F").quote;
  expect(quote?.previousClose).toBe(0);
  expect(quote).not.toHaveProperty("change");
  expect(quote).not.toHaveProperty("changePercent");
});

test("Yahoo error payloads throw a recognizable shape error", () => {
  const body = JSON.stringify({
    chart: {
      result: null,
      error: { code: "Not Found", description: "No data found, symbol may be delisted" },
    },
  });

  expect(() => parseYahooChart(body, "BAD-SYMBOL")).toThrow(
    "unexpected Yahoo Finance chart response shape: Not Found",
  );
});

test("Yahoo quote fetching fails over from query1 to query2 on transport errors", async () => {
  const requested: string[] = [];
  const quote = await fetchYahooQuote("CL=F", {
    interval: "1d",
    range: "1mo",
    fetch: (input) => {
      const url = fetchInputUrl(input);
      requested.push(url);
      if (url.includes("query1.finance.yahoo.com")) {
        return Promise.resolve(new Response("unauthorized", { status: 401 }));
      }
      return Promise.resolve(new Response(chartFixture));
    },
  });

  expect(quote?.price).toBe(82.5);
  expect(requested.map((url) => new URL(url).host)).toEqual([
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
  ]);
});
