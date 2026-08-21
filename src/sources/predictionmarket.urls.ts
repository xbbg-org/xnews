export interface PredictionMarketQuote {
  readonly venue: "kalshi" | "polymarket" | "manifold";
  readonly id: string;
  readonly question: string;
  readonly url: string;
  /** Implied probability of YES, 0-1. */
  readonly probability: number;
  readonly volume?: number;
  readonly liquidity?: number;
  readonly closesAt?: string;
  readonly category?: string;
}
