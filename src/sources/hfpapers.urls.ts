import { normalizeLimit } from "../options.js";

export interface HfDailyPapersUrlOptions {
  readonly limit?: number;
  readonly date?: string;
}

export const HF_DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers";

export function hfDailyPapersUrl(options: HfDailyPapersUrlOptions = {}): string {
  const limit = normalizeLimit(options.limit);
  if (options.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new RangeError("date must use YYYY-MM-DD format");
  }

  const url = new URL(HF_DAILY_PAPERS_URL);
  if (options.date !== undefined) url.searchParams.set("date", options.date);
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
  return url.toString();
}
