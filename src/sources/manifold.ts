import { fetchJsonText } from "../http.js";
import { isRecord, numberField, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { MANIFOLD_MARKETS_URL } from "./manifold.urls.js";
import type { PredictionMarketQuote } from "./predictionmarket.urls.js";
import type { SourceFetchOptions } from "../types.js";

export { MANIFOLD_MARKETS_URL } from "./manifold.urls.js";

export async function fetchManifoldMarkets(
  options: SourceFetchOptions = {},
): Promise<PredictionMarketQuote[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const markets = parseManifoldMarkets(await fetchJsonText(MANIFOLD_MARKETS_URL, options));
  return limit === undefined ? markets : markets.slice(0, limit);
}

export function parseManifoldMarkets(body: string): PredictionMarketQuote[] {
  const records = parseMarketArray(body);
  const quotes: PredictionMarketQuote[] = [];
  for (const market of records) {
    const id = nonBlank(stringField(market, "id"));
    const question = nonBlank(stringField(market, "question"));
    const url = nonBlank(stringField(market, "url"));
    const probability = manifoldYesProbability(market);
    if (!id || !question || !url || probability === undefined) continue;

    const volume = numberField(market, "volume24Hours");
    const closeTime = numberField(market, "closeTime");
    const closesAt = closeTime === undefined ? undefined : epochMillisToIso(closeTime);
    quotes.push({
      venue: "manifold",
      id,
      question,
      url,
      probability,
      ...(volume !== undefined ? { volume } : {}),
      ...(closesAt ? { closesAt } : {}),
    });
  }
  return quotes;
}

/** Manifold publishes YES probability directly on a 0-1 scale. */
function manifoldYesProbability(market: Record<string, unknown>): number | undefined {
  const probability = numberField(market, "probability");
  return probability === undefined ? undefined : Math.min(1, Math.max(0, probability));
}

function epochMillisToIso(value: number): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseMarketArray(body: string): readonly Record<string, unknown>[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("unexpected non-JSON Manifold markets response");
  }
  if (!Array.isArray(payload)) {
    throw new Error("unexpected Manifold markets response shape");
  }

  const records = payload.filter(isRecord);
  if (payload.length > 0 && records.length === 0) {
    throw new Error("unexpected Manifold markets response shape");
  }
  return records;
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
