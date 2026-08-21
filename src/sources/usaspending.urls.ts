import { normalizeDateWindow, normalizeLimit } from "../options.js";

export const USASPENDING_SEARCH_URL =
  "https://api.usaspending.gov/api/v2/search/spending_by_award/";
export const USASPENDING_AWARDS_URL = "https://www.usaspending.gov/search";
export const USASPENDING_AWARD_BASE_URL = "https://www.usaspending.gov/award/";
export const USASPENDING_DEFAULT_LIMIT = 100;

export const USASPENDING_AWARD_TYPE_CODES = ["A", "B", "C", "D"] as const;
export const USASPENDING_AWARD_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Awarding Agency",
  "Award Type",
  "Start Date",
  "End Date",
  "Description",
  "generated_internal_id",
] as const;

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;

export interface UsaSpendingDateWindowOptions {
  readonly since?: string | Date;
  readonly until?: string | Date;
}

export interface UsaSpendingDateWindow {
  readonly startDate: string;
  readonly endDate: string;
}

export interface UsaSpendingSearchBodyOptions extends UsaSpendingDateWindowOptions {
  readonly page?: number;
  readonly limit?: number;
}

export interface UsaSpendingSearchBody {
  readonly filters: {
    readonly award_type_codes: readonly ["A", "B", "C", "D"];
    readonly time_period: readonly [
      {
        readonly start_date: string;
        readonly end_date: string;
      },
    ];
  };
  readonly fields: typeof USASPENDING_AWARD_FIELDS;
  readonly page: number;
  readonly limit: number;
  readonly sort: "Award Amount";
  readonly order: "desc";
  readonly subawards: false;
}

/** Resolves the API's inclusive date window, using 30 UTC calendar dates by default. */
export function usaSpendingDateWindow(
  options: UsaSpendingDateWindowOptions = {},
  now: Date = new Date(),
): UsaSpendingDateWindow {
  const window = normalizeDateWindow(options);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError("now must be a valid date");

  const endMs = window.untilMs ?? nowMs;
  const startMs = window.sinceMs ?? endMs - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS;
  if (startMs > endMs) throw new RangeError("since must be before or equal to until");

  return {
    startDate: isoDate(startMs),
    endDate: isoDate(endMs),
  };
}

/** Builds the exact JSON payload accepted by USAspending's award search. */
export function usaSpendingSearchBody(
  options: UsaSpendingSearchBodyOptions = {},
  now: Date = new Date(),
): UsaSpendingSearchBody {
  const window = usaSpendingDateWindow(options, now);
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("page must be a positive integer");
  }
  const limit = normalizeLimit(options.limit) ?? USASPENDING_DEFAULT_LIMIT;

  return {
    filters: {
      award_type_codes: USASPENDING_AWARD_TYPE_CODES,
      time_period: [
        {
          start_date: window.startDate,
          end_date: window.endDate,
        },
      ],
    },
    fields: USASPENDING_AWARD_FIELDS,
    page,
    limit,
    sort: "Award Amount",
    order: "desc",
    subawards: false,
  };
}

export function usaSpendingAwardUrl(generatedInternalId: string): string {
  return `${USASPENDING_AWARD_BASE_URL}${encodeURIComponent(generatedInternalId)}`;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
