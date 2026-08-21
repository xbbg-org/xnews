import { normalizeDateOnly } from "../dates.js";
import { fetchText } from "../http.js";
import { NOAA_CO2_URL } from "./noaaco2.urls.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";

export { NOAA_CO2_URL } from "./noaaco2.urls.js";

export interface NoaaCo2Row {
  readonly date: string;
  readonly smoothed?: number;
  readonly trend?: number;
}

export function parseNoaaCo2(body: string): NoaaCo2Row[] {
  const lines = body.split(/\r?\n/);
  const rows: NoaaCo2Row[] = [];
  let sawDataLine = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    sawDataLine = true;
    const [yearText, monthText, dayText, smoothedText, trendText] = line.split(/\s+/);
    if (
      yearText === undefined ||
      monthText === undefined ||
      dayText === undefined ||
      smoothedText === undefined ||
      trendText === undefined
    ) {
      continue;
    }
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = isoDate(year, month, day);
    if (date === undefined) continue;
    const smoothed = finiteNumber(smoothedText);
    const trend = finiteNumber(trendText);
    if (smoothed === undefined && trend === undefined) continue;
    rows.push({
      date,
      ...(smoothed === undefined ? {} : { smoothed }),
      ...(trend === undefined ? {} : { trend }),
    });
  }

  if (sawDataLine && rows.length === 0) {
    throw new Error("unexpected NOAA CO2 response shape");
  }
  return rows;
}

export async function fetchNoaaCo2(options: SourceFetchOptions = {}): Promise<NoaaCo2Row[]> {
  return parseNoaaCo2(await fetchText(NOAA_CO2_URL, options));
}

export function noaaCo2DataSource(options: SourceFetchOptions = {}): DataSource<NoaaCo2Row> {
  return {
    provider: "noaa-co2",
    dataset: "co2-trend-global",
    requestUrls: () => [NOAA_CO2_URL],
    fetchRelease: async (fetchOptions = {}): Promise<DataRelease<NoaaCo2Row> | undefined> => {
      const rows = await fetchNoaaCo2({ ...options, ...fetchOptions });
      let asOf: string | undefined;
      for (const row of rows) {
        if (asOf === undefined || row.date > asOf) asOf = row.date;
      }
      if (asOf === undefined) return undefined;
      return {
        provider: "noaa-co2",
        dataset: "co2-trend-global",
        asOf,
        url: NOAA_CO2_URL,
        rows,
      };
    },
  };
}

function isoDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
  return normalizeDateOnly(candidate) ?? undefined;
}

function finiteNumber(value: string): number | undefined {
  if (value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
