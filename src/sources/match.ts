import type { NewsItem } from "../types";

export interface SubjectMatchTerms {
  readonly ticker?: string;
  readonly companyName?: string;
  readonly query?: string;
}

export type SubjectMatchItem = Pick<NewsItem, "title"> & Partial<Pick<NewsItem, "summary">>;

/**
 * Builds a deterministic text matcher used to filter fixed market-news feeds
 * (feeds without native per-subject query support) down to one subject.
 *
 * - `query` matches when every whitespace-separated token appears in the item
 *   text, case-insensitively, at token boundaries.
 * - `companyName` matches as a case-insensitive boundary-guarded phrase.
 * - `ticker` matches case-sensitively as a standalone uppercase token, which
 *   also covers `$RGA` and `NYSE:RGA` style mentions.
 */
export function subjectMatcher(terms: SubjectMatchTerms): (item: SubjectMatchItem) => boolean {
  const patterns: RegExp[][] = [];

  const query = terms.query?.trim();
  if (query) {
    const tokens = query
      .split(/\s+/)
      .map((token) => token.replace(/^["']+|["']+$/g, ""))
      .filter(Boolean);
    if (tokens.length > 0) patterns.push(tokens.map((token) => boundaryPattern(token, "i")));
  }

  const companyName = terms.companyName?.trim();
  if (companyName) patterns.push([boundaryPattern(companyName, "i")]);

  const ticker = terms.ticker?.trim().toUpperCase();
  if (ticker) {
    // A bare single-letter token ("A", "T") appears constantly in prose, so
    // length-1 tickers only match with cashtag or exchange-prefix context.
    patterns.push([
      ticker.length === 1
        ? new RegExp(`(?:\\$|[A-Z]{2,}:\\s?)${ticker}(?![A-Za-z0-9])`)
        : boundaryPattern(ticker, ""),
    ]);
  }

  if (patterns.length === 0) return () => false;

  return (item) => {
    const text = `${item.title} ${item.summary ?? ""}`;
    return patterns.some((group) => group.every((pattern) => pattern.test(text)));
  };
}

function boundaryPattern(term: string, flags: string): RegExp {
  const escaped = term
    .replace(/\s+/g, " ")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, flags);
}
