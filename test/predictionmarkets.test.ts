import { expect, test } from "bun:test";
import {
  KALSHI_MARKETS_URL,
  MANIFOLD_MARKETS_URL,
  POLYMARKET_MARKETS_URL,
} from "../src/catalog.js";
import { fetchKalshiMarkets, fetchManifoldMarkets, fetchPolymarketMarkets } from "../src/index.js";
import {
  parseKalshiMarkets,
  parseManifoldMarkets,
  parsePolymarketMarkets,
} from "../src/parsers.js";

// Mirrors the live Kalshi v2 schema: decimal-string dollar prices, `_fp`/
// `_dollars` numeric strings, and a per-market title distinct from the event's.
const KALSHI_FIXTURE = JSON.stringify({
  events: [
    {
      event_ticker: "FED-DECISION",
      title: "What will the Federal Reserve do in September?",
      category: "Economics",
      markets: [
        {
          ticker: "FED-DECISION-CUT",
          title: "Will the Federal Reserve cut rates in September?",
          yes_bid_dollars: "0.4100",
          yes_ask_dollars: "0.4300",
          notional_value_dollars: "1.0000",
          volume_fp: "12500.00",
          liquidity_dollars: "8250.00",
          close_time: "2026-09-16T18:00:00Z",
        },
        {
          ticker: "FED-DECISION-HOLD",
          title: "Will the Federal Reserve hold rates in September?",
          yes_bid_dollars: "0.0000",
          yes_ask_dollars: "0.6400",
          notional_value_dollars: "1.0000",
          volume_fp: "4000.00",
          liquidity_dollars: "2300.00",
          close_time: "2026-09-16T18:00:00Z",
        },
        {
          ticker: "FED-DECISION-NO-QUOTE",
          title: "Will an unquoted leg be dropped?",
          yes_bid_dollars: "0.0000",
          yes_ask_dollars: "0.0000",
          volume_fp: "20.00",
        },
        {
          ticker: "FED-DECISION-UNTITLED",
          yes_bid_dollars: "0.1000",
          yes_ask_dollars: "0.1200",
        },
      ],
    },
  ],
});

const POLYMARKET_FIXTURE = JSON.stringify([
  {
    slug: "mars-landing-before-2030",
    question: "Will humans land on Mars before 2030?",
    outcomePrices: '["0.63", "0.37"]',
    volumeNum: 2_500_000,
    liquidityNum: 350_000,
    endDate: "2029-12-31T23:59:59Z",
  },
  {
    slug: "malformed-outcomes",
    question: "Will this malformed market be skipped?",
    outcomePrices: "not-json",
    volumeNum: 100,
  },
  {
    slug: "clamped-outcome",
    question: "Will this quote be clamped?",
    outcomePrices: '["1.2", "-0.2"]',
  },
  {
    slug: "missing-outcomes",
    question: "Will this missing quote be dropped?",
  },
]);

const MANIFOLD_CLOSE_TIME = Date.UTC(2026, 7, 31, 12);
const MANIFOLD_FIXTURE = JSON.stringify([
  {
    id: "manifold-mars",
    question: "Will SpaceX launch a crewed Mars mission before 2030?",
    probability: 0.28,
    volume24Hours: 18_400,
    closeTime: MANIFOLD_CLOSE_TIME,
    url: "https://manifold.markets/example/mars-before-2030",
  },
  {
    id: "manifold-no-price",
    question: "Will a market without a probability be dropped?",
    volume24Hours: 12,
    url: "https://manifold.markets/example/no-price",
  },
  {
    id: "manifold-clamped",
    question: "Will an out-of-range probability be clamped?",
    probability: 1.4,
    url: "https://manifold.markets/example/clamped",
  },
]);

test("normalizes Kalshi dollar quotes with midpoint and one-sided fallback", () => {
  const quotes = parseKalshiMarkets(KALSHI_FIXTURE);

  expect(quotes).toHaveLength(3);
  expect(quotes[0]).toEqual({
    venue: "kalshi",
    id: "FED-DECISION-CUT",
    question: "Will the Federal Reserve cut rates in September?",
    url: "https://kalshi.com/markets/fed-decision",
    probability: 0.42,
    volume: 12_500,
    liquidity: 8_250,
    closesAt: "2026-09-16T18:00:00Z",
    category: "Economics",
  });
  // A zero bid means no resting order, so the ask stands alone rather than
  // dragging the midpoint toward a false 32%.
  expect(quotes[1]?.probability).toBe(0.64);
  expect(quotes.some((quote) => quote.id === "FED-DECISION-NO-QUOTE")).toBe(false);
});

test("prices are dollars, not cents, so probability is not scaled by 100", () => {
  const [cut] = parseKalshiMarkets(KALSHI_FIXTURE);
  // The live v2 API replaced integer-cent `yes_bid`/`yes_ask` with
  // decimal-string `*_dollars`. Reading those as cents would report 0.0042.
  expect(cut?.probability).toBeCloseTo(0.42, 10);
});

test("a market without its own title falls back to the event title", () => {
  const untitled = parseKalshiMarkets(KALSHI_FIXTURE).find(
    (quote) => quote.id === "FED-DECISION-UNTITLED",
  );
  expect(untitled?.question).toBe("What will the Federal Reserve do in September?");
  expect(untitled?.probability).toBeCloseTo(0.11, 10);
});

test("a non-unit notional divides the price into a probability", () => {
  const quotes = parseKalshiMarkets(
    JSON.stringify({
      events: [
        {
          event_ticker: "CENTI",
          title: "Hundred dollar notional",
          markets: [
            {
              ticker: "CENTI-YES",
              yes_bid_dollars: "30.00",
              yes_ask_dollars: "40.00",
              notional_value_dollars: "100.0000",
            },
          ],
        },
      ],
    }),
  );
  expect(quotes[0]?.probability).toBeCloseTo(0.35, 10);
});

test("decodes Polymarket outcome prices and skips malformed nested JSON", () => {
  const quotes = parsePolymarketMarkets(POLYMARKET_FIXTURE);

  expect(quotes).toHaveLength(2);
  expect(quotes[0]).toEqual({
    venue: "polymarket",
    id: "mars-landing-before-2030",
    question: "Will humans land on Mars before 2030?",
    url: "https://polymarket.com/market/mars-landing-before-2030",
    probability: 0.63,
    volume: 2_500_000,
    liquidity: 350_000,
    closesAt: "2029-12-31T23:59:59Z",
  });
  expect(quotes[1]?.probability).toBe(1);
  expect(quotes.some((quote) => quote.id === "malformed-outcomes")).toBe(false);
  expect(quotes.some((quote) => quote.id === "missing-outcomes")).toBe(false);
});

test("converts Manifold epoch milliseconds and drops absent probabilities", () => {
  const quotes = parseManifoldMarkets(MANIFOLD_FIXTURE);

  expect(quotes).toHaveLength(2);
  expect(quotes[0]).toEqual({
    venue: "manifold",
    id: "manifold-mars",
    question: "Will SpaceX launch a crewed Mars mission before 2030?",
    url: "https://manifold.markets/example/mars-before-2030",
    probability: 0.28,
    volume: 18_400,
    closesAt: "2026-08-31T12:00:00.000Z",
  });
  expect(quotes[1]?.probability).toBe(1);
  expect(quotes.some((quote) => quote.id === "manifold-no-price")).toBe(false);
});

test("drops non-finite probabilities instead of manufacturing zeroes", () => {
  const kalshi = parseKalshiMarkets(`{
    "events": [{
      "event_ticker": "NON-FINITE",
      "title": "Will this invalid Kalshi quote be dropped?",
      "markets": [{
        "ticker": "NON-FINITE-YES",
        "yes_bid_dollars": "1e999",
        "yes_ask_dollars": "not-a-number"
      }]
    }]
  }`);
  const polymarket = parsePolymarketMarkets(
    JSON.stringify([
      {
        slug: "non-finite",
        question: "Will this invalid Polymarket quote be dropped?",
        outcomePrices: '["1e999", "0"]',
      },
    ]),
  );
  const manifold = parseManifoldMarkets(`[
    {
      "id": "non-finite",
      "question": "Will this invalid Manifold quote be dropped?",
      "probability": 1e999,
      "url": "https://manifold.markets/example/non-finite"
    }
  ]`);

  expect(kalshi).toEqual([]);
  expect(polymarket).toEqual([]);
  expect(manifold).toEqual([]);
});

test("fetches every venue through the injected transport", async () => {
  const bodies: Readonly<Record<string, string>> = {
    [KALSHI_MARKETS_URL]: KALSHI_FIXTURE,
    [POLYMARKET_MARKETS_URL]: POLYMARKET_FIXTURE,
    [MANIFOLD_MARKETS_URL]: MANIFOLD_FIXTURE,
  };
  const requestedUrls: string[] = [];
  const injectedFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = bodies[url];
    if (body === undefined) throw new Error(`unexpected test URL: ${url}`);
    requestedUrls.push(url);
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  };

  const [kalshi, polymarket, manifold] = await Promise.all([
    fetchKalshiMarkets({ fetch: injectedFetch, limit: 1 }),
    fetchPolymarketMarkets({ fetch: injectedFetch, limit: 1 }),
    fetchManifoldMarkets({ fetch: injectedFetch, limit: 1 }),
  ]);

  expect(kalshi).toHaveLength(1);
  expect(polymarket).toHaveLength(1);
  expect(manifold).toHaveLength(1);
  expect(requestedUrls.toSorted()).toEqual(
    [KALSHI_MARKETS_URL, POLYMARKET_MARKETS_URL, MANIFOLD_MARKETS_URL].toSorted(),
  );
});
