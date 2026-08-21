import { fetchJsonText } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { KALSHI_MARKETS_URL } from "./kalshi.urls.js";
import type { PredictionMarketQuote } from "./predictionmarket.urls.js";
import type { SourceFetchOptions } from "../types.js";

export { KALSHI_MARKETS_URL } from "./kalshi.urls.js";

const KALSHI_SHAPE_ERROR = "unexpected Kalshi markets response shape";

export async function fetchKalshiMarkets(
  options: SourceFetchOptions = {},
): Promise<PredictionMarketQuote[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const markets = parseKalshiMarkets(await fetchJsonText(KALSHI_MARKETS_URL, options));
  return limit === undefined ? markets : markets.slice(0, limit);
}

export function parseKalshiMarkets(body: string): PredictionMarketQuote[] {
  const payload = parseJsonRecord(body, "Kalshi markets");
  const eventValues = payload["events"];
  if (!Array.isArray(eventValues)) throw new Error(KALSHI_SHAPE_ERROR);

  const events = recordArray(eventValues);
  if (eventValues.length > 0 && events.length === 0) throw new Error(KALSHI_SHAPE_ERROR);

  const quotes: PredictionMarketQuote[] = [];
  let sawNestedMarkets = false;
  for (const event of events) {
    const eventTicker = nonBlank(stringField(event, "event_ticker"));
    const eventTitle = nonBlank(stringField(event, "title"));
    const marketValues = event["markets"];
    if (!Array.isArray(marketValues)) continue;
    sawNestedMarkets = true;
    if (!eventTicker) continue;

    const url = `https://kalshi.com/markets/${encodeURIComponent(eventTicker.toLowerCase())}`;
    const category = nonBlank(stringField(event, "category"));
    for (const market of marketValues) {
      if (!isRecord(market)) continue;
      const id = nonBlank(stringField(market, "ticker"));
      // A multi-outcome event ("Who wins?") gives each market its own title
      // naming the outcome; the event title alone would label every leg
      // identically. Fall back to the event title for single-market events.
      const question = nonBlank(stringField(market, "title")) ?? eventTitle;
      const probability = kalshiYesProbability(market);
      if (!id || !question || probability === undefined) continue;

      const volume = decimalField(market, "volume_fp");
      const liquidity = decimalField(market, "liquidity_dollars");
      const closesAt = nonBlank(stringField(market, "close_time"));
      quotes.push({
        venue: "kalshi",
        id,
        question,
        url,
        probability,
        ...(volume !== undefined ? { volume } : {}),
        ...(liquidity !== undefined ? { liquidity } : {}),
        ...(closesAt ? { closesAt } : {}),
        ...(category ? { category } : {}),
      });
    }
  }

  if (events.length > 0 && !sawNestedMarkets) throw new Error(KALSHI_SHAPE_ERROR);
  return quotes;
}

/**
 * Kalshi quotes YES as a decimal-string price in dollars (`"0.1200"`), not the
 * integer cents its older API used. A contract settles at
 * `notional_value_dollars`, so price over notional is the implied probability;
 * notional is $1 for every binary market Kalshi currently lists, but dividing
 * keeps this correct if a differently denominated contract appears rather than
 * silently reporting a 100x probability.
 *
 * A two-sided quote becomes its midpoint. A one-sided quote stands alone — a
 * zero or missing side means no resting order, not a zero-probability market.
 */
function kalshiYesProbability(market: Record<string, unknown>): number | undefined {
  const bid = nonZeroDecimalField(market, "yes_bid_dollars");
  const ask = nonZeroDecimalField(market, "yes_ask_dollars");
  const price = bid !== undefined && ask !== undefined ? (bid + ask) / 2 : (bid ?? ask);
  if (price === undefined) return undefined;

  const notional = decimalField(market, "notional_value_dollars");
  const denominator = notional !== undefined && notional > 0 ? notional : 1;
  const probability = price / denominator;
  if (!Number.isFinite(probability)) return undefined;
  return Math.min(1, Math.max(0, probability));
}

/**
 * Kalshi renders every numeric as a decimal string (`"117303.13"`). Rejects
 * anything non-finite so a malformed field is absent rather than `NaN`.
 */
function decimalField(record: Record<string, unknown>, key: string): number | undefined {
  const raw = record[key];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

function nonZeroDecimalField(record: Record<string, unknown>, key: string): number | undefined {
  const value = decimalField(record, key);
  return value !== undefined && value !== 0 ? value : undefined;
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
