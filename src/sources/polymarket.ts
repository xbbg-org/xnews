import { fetchJsonText } from "../http.js";
import { isRecord, numberField, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { POLYMARKET_MARKETS_URL } from "./polymarket.urls.js";
import type { PredictionMarketQuote } from "./predictionmarket.urls.js";
import type { SourceFetchOptions } from "../types.js";

export { POLYMARKET_MARKETS_URL } from "./polymarket.urls.js";

export async function fetchPolymarketMarkets(
  options: SourceFetchOptions = {},
): Promise<PredictionMarketQuote[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const markets = parsePolymarketMarkets(await fetchJsonText(POLYMARKET_MARKETS_URL, options));
  return limit === undefined ? markets : markets.slice(0, limit);
}

export function parsePolymarketMarkets(body: string): PredictionMarketQuote[] {
  const records = parseMarketArray(body, "Polymarket");
  const quotes: PredictionMarketQuote[] = [];
  for (const market of records) {
    const slug = nonBlank(stringField(market, "slug"));
    const question = nonBlank(stringField(market, "question"));
    const probability = polymarketYesProbability(market);
    if (!slug || !question || probability === undefined) continue;

    const volume = numberField(market, "volumeNum");
    const liquidity = numberField(market, "liquidityNum");
    const closesAt = nonBlank(stringField(market, "endDate"));
    quotes.push({
      venue: "polymarket",
      id: slug,
      question,
      url: `https://polymarket.com/market/${slug}`,
      probability,
      ...(volume !== undefined ? { volume } : {}),
      ...(liquidity !== undefined ? { liquidity } : {}),
      ...(closesAt ? { closesAt } : {}),
    });
  }
  return quotes;
}

/**
 * Gamma encodes its outcome vector as JSON inside a string. The first value
 * is YES, expressed directly on a 0-1 scale, so it only needs validation and
 * clamping after the nested JSON is decoded.
 */
function polymarketYesProbability(market: Record<string, unknown>): number | undefined {
  const encoded = stringField(market, "outcomePrices");
  if (encoded === undefined) return undefined;

  let outcomes: unknown;
  try {
    outcomes = JSON.parse(encoded);
  } catch {
    return undefined;
  }
  if (!Array.isArray(outcomes)) return undefined;

  const yes = finiteNumericValue(outcomes[0]);
  return yes === undefined ? undefined : Math.min(1, Math.max(0, yes));
}

function parseMarketArray(body: string, apiLabel: string): readonly Record<string, unknown>[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`unexpected non-JSON ${apiLabel} markets response`);
  }
  if (!Array.isArray(payload)) {
    throw new Error(`unexpected ${apiLabel} markets response shape`);
  }

  const records = payload.filter(isRecord);
  if (payload.length > 0 && records.length === 0) {
    throw new Error(`unexpected ${apiLabel} markets response shape`);
  }
  return records;
}

function finiteNumericValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
