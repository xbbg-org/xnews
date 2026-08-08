/**
 * Publication-time normalization.
 *
 * `parsePublishedAt` is the single place raw upstream date text becomes a UTC
 * instant. It is pure, total, and versioned: consumers that store
 * `publishedAtText` can re-derive `publishedAt` after a parser fix by
 * comparing `PUBLISHED_AT_PARSER_VERSION`. Explicit feed and provider formats
 * are parsed without the host engine's date parser; unknown formats fall back
 * to it and are tagged `engine`.
 */

export const PUBLISHED_AT_PARSER_VERSION = 1;

export type PublishedAtFormat =
  | "iso_8601"
  | "rfc_822"
  | "date_only"
  | "finviz"
  | "gdelt"
  | "dotnet"
  | "engine";

export interface ParsedPublishedAt {
  /** ISO 8601 UTC instant with millisecond precision, e.g. `2026-06-22T13:00:00.000Z`. */
  readonly instant: string;
  readonly format: PublishedAtFormat;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// RFC 822 zone names plus the obsolete forms RFC 2822 section 4.3 still
// requires accepting. Unknown alphabetic zones fall through to the engine.
const ZONE_OFFSET_MINUTES: Record<string, number> = {
  UT: 0,
  GMT: 0,
  UTC: 0,
  Z: 0,
  EST: -5 * 60,
  EDT: -4 * 60,
  CST: -6 * 60,
  CDT: -5 * 60,
  MST: -7 * 60,
  MDT: -6 * 60,
  PST: -8 * 60,
  PDT: -7 * 60,
};

const RFC_822_PATTERN =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*,\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(UT|GMT|UTC|Z|EST|EDT|CST|CDT|MST|MDT|PST|PDT|[+-]\d{4})?$/i;
const ISO_8601_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|z|[+-]\d{2}:?\d{2})?$/;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const GDELT_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const DOTNET_PATTERN = /^\/Date\((-?\d+)(?:[+-](\d{2})(\d{2}))?\)\/$/;
const FINVIZ_PATTERN = /^([A-Z][a-z]{2})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})([AP]M)$/i;

export function parsePublishedAt(text: string): ParsedPublishedAt | null {
  const value = text.trim();
  if (!value) return null;

  const isoMatch = value.match(ISO_8601_PATTERN);
  if (isoMatch) return parsed(isoInstant(isoMatch), "iso_8601");

  const dateOnlyMatch = value.match(DATE_ONLY_PATTERN);
  if (dateOnlyMatch) {
    return parsed(
      utcInstant(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
        0,
        0,
        0,
        0,
        0,
      ),
      "date_only",
    );
  }

  const rfcMatch = value.match(RFC_822_PATTERN);
  if (rfcMatch) return parsed(rfc822Instant(rfcMatch), "rfc_822");

  const gdeltMatch = value.match(GDELT_PATTERN);
  if (gdeltMatch) {
    return parsed(
      utcInstant(
        Number(gdeltMatch[1]),
        Number(gdeltMatch[2]) - 1,
        Number(gdeltMatch[3]),
        Number(gdeltMatch[4]),
        Number(gdeltMatch[5]),
        Number(gdeltMatch[6]),
        0,
        0,
      ),
      "gdelt",
    );
  }

  const dotnetMatch = value.match(DOTNET_PATTERN);
  if (dotnetMatch) return parsed(dotnetInstant(dotnetMatch), "dotnet");

  const finvizMatch = value.match(FINVIZ_PATTERN);
  if (finvizMatch) return parsed(finvizInstant(finvizMatch), "finviz");

  const engineParsed = new Date(value);
  return Number.isNaN(engineParsed.getTime())
    ? null
    : { instant: engineParsed.toISOString(), format: "engine" };
}

/**
 * Normalizes a real ISO date or date-time to its UTC calendar date.
 * Returns `null` for invalid dates, non-ISO strings, and invalid `Date` objects.
 */
export function normalizeDateOnly(value: string | Date): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const parsedValue = parsePublishedAt(value);
  return parsedValue?.format === "date_only" || parsedValue?.format === "iso_8601"
    ? parsedValue.instant.slice(0, 10)
    : null;
}

function parsed(instant: string | null, format: PublishedAtFormat): ParsedPublishedAt | null {
  return instant === null ? null : { instant, format };
}

function isoInstant(match: RegExpMatchArray): string | null {
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const milliseconds = fraction === undefined ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
  // A missing offset is read as UTC. The ECMAScript default of local time
  // would make the result depend on the host machine's timezone.
  const offsetMinutes = zone === undefined ? 0 : parseZoneOffsetMinutes(zone);
  if (offsetMinutes === null) return null;
  return utcInstant(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second === undefined ? 0 : Number(second),
    milliseconds,
    offsetMinutes,
  );
}

function rfc822Instant(match: RegExpMatchArray): string | null {
  const [, day, monthName, yearText, hour, minute, second, zone] = match;
  const month = MONTHS[monthName!.toLowerCase()];
  if (month === undefined) return null;

  let year = Number(yearText);
  // RFC 2822 section 4.3: two-digit years below 50 are 2000s, the rest 1900s.
  if (yearText!.length <= 2) year += year < 50 ? 2000 : 1900;
  else if (yearText!.length === 3) year += 1900;

  // A missing zone is read as UTC rather than the engine's local time.
  const offsetMinutes = zone === undefined ? 0 : parseZoneOffsetMinutes(zone.toUpperCase());
  if (offsetMinutes === null) return null;
  return utcInstant(
    year,
    month,
    Number(day),
    Number(hour),
    Number(minute),
    second === undefined ? 0 : Number(second),
    0,
    offsetMinutes,
  );
}

function finvizInstant(match: RegExpMatchArray): string | null {
  const [, monthName, dayText, yearText, hourText, minuteText, meridiem] = match;
  const month = MONTHS[monthName!.toLowerCase()];
  const hour12 = Number(hourText);
  if (month === undefined || hour12 < 1 || hour12 > 12) return null;

  const year = 2000 + Number(yearText);
  const hour = meridiem!.toUpperCase() === "PM" ? (hour12 % 12) + 12 : hour12 % 12;
  const day = Number(dayText);
  const minute = Number(minuteText);
  if (componentUtcMillis(year, month, day, hour, minute, 0, 0) === null) return null;
  const offsetMinutes = easternOffsetMinutes(year, month, day, hour);
  return offsetMinutes === null
    ? null
    : utcInstant(year, month, day, hour, minute, 0, 0, offsetMinutes);
}

function dotnetInstant(match: RegExpMatchArray): string | null {
  const [, timestampText, offsetHour, offsetMinute] = match;
  if (
    (offsetHour !== undefined && Number(offsetHour) > 23) ||
    (offsetMinute !== undefined && Number(offsetMinute) > 59)
  ) {
    return null;
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseZoneOffsetMinutes(zone: string): number | null {
  const named = ZONE_OFFSET_MINUTES[zone.toUpperCase()];
  if (named !== undefined) return named;
  const numeric = zone.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!numeric) return null;
  const hours = Number(numeric[2]);
  const minutes = Number(numeric[3]);
  if (hours > 23 || minutes > 59) return null;
  const sign = numeric[1] === "-" ? -1 : 1;
  return sign * (hours * 60 + minutes);
}

function utcInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  offsetMinutes: number,
): string | null {
  const utcMs = componentUtcMillis(year, month, day, hour, minute, second, millisecond);
  if (utcMs === null) return null;
  const date = new Date(utcMs - offsetMinutes * 60_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function componentUtcMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number | null {
  if (
    ![year, month, day, hour, minute, second, millisecond].every(Number.isInteger) ||
    year < 0 ||
    year > 9999 ||
    month < 0 ||
    month > 11 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 60 ||
    millisecond < 0 ||
    millisecond > 999
  ) {
    return null;
  }

  // setUTCFullYear avoids Date.UTC's legacy remapping of years 0-99 to
  // 1900-1999. Setting the complete validated tuple remains deterministic.
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function daysInMonth(year: number, month: number): number {
  if (month === 1) return isLeapYear(year) ? 29 : 28;
  return month === 3 || month === 5 || month === 8 || month === 10 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** US Eastern rules covering every two-digit Finviz year (2000-2099). */
function easternOffsetMinutes(
  year: number,
  month: number,
  day: number,
  hour: number,
): number | null {
  const modernRules = year >= 2007;
  const startMonth = modernRules ? 2 : 3;
  const startDay = nthWeekdayOfMonth(year, startMonth, 0, modernRules ? 2 : 1);
  const endMonth = modernRules ? 10 : 9;
  const endDay = modernRules
    ? nthWeekdayOfMonth(year, endMonth, 0, 1)
    : lastWeekdayOfMonth(year, endMonth, 0);

  if (month < startMonth || month > endMonth) return -5 * 60;
  if (month > startMonth && month < endMonth) return -4 * 60;
  if (month === startMonth) {
    if (day < startDay || (day === startDay && hour < 2)) return -5 * 60;
    // 02:00-02:59 does not exist on the spring transition day.
    if (day === startDay && hour === 2) return null;
    return -4 * 60;
  }
  if (day < endDay || (day === endDay && hour < 2)) return -4 * 60;
  return -5 * 60;
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
): number {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (occurrence - 1) * 7;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const lastDay = daysInMonth(year, month);
  const lastWeekday = new Date(Date.UTC(year, month, lastDay)).getUTCDay();
  return lastDay - ((lastWeekday - weekday + 7) % 7);
}
