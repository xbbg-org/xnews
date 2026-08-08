import { fetchText } from "../http.js";
import { isRecord, parseJsonRecord, stringField } from "../json.js";
import {
  alphaVantageTranscriptUrl,
  type AlphaVantageTranscriptOptions,
} from "./alphavantage.urls.js";
export { alphaVantageTranscriptUrl } from "./alphavantage.urls.js";
export type { AlphaVantageTranscriptOptions } from "./alphavantage.urls.js";

/** One speaker turn of an Alpha Vantage transcript. */
export interface AlphaVantageTranscriptTurn {
  readonly speaker: string;
  /** Speaker's role/title as labeled upstream, when present. */
  readonly title?: string;
  readonly content: string;
  /** Upstream per-turn LLM sentiment in [-1, 1], when parseable. */
  readonly sentiment?: number;
}

/** One fiscal quarter's earnings-call transcript from Alpha Vantage. */
export interface AlphaVantageTranscript {
  readonly symbol: string;
  /** Fiscal quarter label as requested, e.g. `"2024Q1"`. */
  readonly quarter: string;
  /** Speaker-attributed turns; empty when no transcript is available yet. */
  readonly turns: readonly AlphaVantageTranscriptTurn[];
  /** Full transcript as one `Speaker: text` string. */
  readonly text: string;
}

/**
 * Fetches one company quarter's earnings-call transcript from Alpha Vantage's
 * `EARNINGS_CALL_TRANSCRIPT` endpoint — the free-key complement to the
 * keyless `hf-transcripts` snapshot: quarters appear shortly after calls and
 * coverage is not limited to the snapshot's issuer list, at the price of an
 * API key and its 25-requests/day free-tier budget.
 */
export async function fetchAlphaVantageTranscript(
  symbol: string,
  quarter: string,
  options: AlphaVantageTranscriptOptions,
): Promise<AlphaVantageTranscript> {
  const body = await fetchText(alphaVantageTranscriptUrl(symbol, quarter, options), options);
  return parseAlphaVantageTranscript(body);
}

/** Parses an `EARNINGS_CALL_TRANSCRIPT` response into a typed transcript. */
export function parseAlphaVantageTranscript(body: string): AlphaVantageTranscript {
  const payload = parseJsonRecord(body, "Alpha Vantage");
  // Alpha Vantage reports failures inside HTTP 200 bodies under varying keys:
  // "Error Message" for bad requests, "Information"/"Note" for rate limits.
  const failure =
    stringField(payload, "Error Message") ??
    stringField(payload, "Information") ??
    stringField(payload, "Note");
  if (failure) {
    throw new Error(`Alpha Vantage request failed: ${failure}`);
  }

  const symbol = stringField(payload, "symbol")?.trim().toUpperCase();
  const quarter = stringField(payload, "quarter")?.trim().toUpperCase();
  if (!symbol || !quarter) {
    throw new Error("unexpected Alpha Vantage response shape");
  }

  const transcript = payload["transcript"];
  if (!Array.isArray(transcript)) {
    throw new Error("unexpected Alpha Vantage response shape");
  }

  const turns: AlphaVantageTranscriptTurn[] = [];
  for (const entry of transcript) {
    if (!isRecord(entry)) continue;
    const speaker = stringField(entry, "speaker")?.trim();
    const content = stringField(entry, "content");
    if (!speaker || !content) continue;
    const title = stringField(entry, "title")?.trim();
    const sentimentText = stringField(entry, "sentiment");
    const sentiment = sentimentText === undefined ? Number.NaN : Number(sentimentText);
    turns.push({
      speaker,
      ...(title ? { title } : {}),
      content,
      ...(Number.isFinite(sentiment) ? { sentiment } : {}),
    });
  }
  if (transcript.length > 0 && turns.length === 0) {
    throw new Error("unexpected Alpha Vantage response shape");
  }

  return {
    symbol,
    quarter,
    turns,
    text: turns.map((turn) => `${turn.speaker}: ${turn.content}`).join("\n\n"),
  };
}
