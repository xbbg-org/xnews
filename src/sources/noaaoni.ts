import { fetchText } from "../http.js";
import {
  isNoaaOniSeason,
  NOAA_ONI_CENTER_MONTHS,
  NOAA_ONI_URL,
  noaaOniAsOf,
} from "./noaaoni.urls.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import type { NoaaOniSeason } from "./noaaoni.urls.js";

const NOAA_ONI_SHAPE_ERROR = "unexpected NOAA ONI response shape";

export {
  isNoaaOniSeason,
  NOAA_ONI_CENTER_MONTHS,
  NOAA_ONI_URL,
  noaaOniAsOf,
} from "./noaaoni.urls.js";
export type { NoaaOniSeason } from "./noaaoni.urls.js";

export type NoaaOniPhase = "el-nino" | "la-nina" | "neutral";

export interface NoaaOniRow {
  readonly season: NoaaOniSeason;
  readonly year: number;
  readonly total: number;
  readonly anomaly: number;
  readonly phase: NoaaOniPhase;
}

/**
 * NOAA CPC uses +0.5 C and -0.5 C as the warm/cold ONI thresholds.
 * https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php
 */
export function noaaOniPhase(anomaly: number): NoaaOniPhase {
  if (anomaly >= 0.5) return "el-nino";
  if (anomaly <= -0.5) return "la-nina";
  return "neutral";
}

export function parseNoaaOni(body: string): NoaaOniRow[] {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  if (lines[0]?.split(/\s+/).slice(0, 4).join(" ") !== "SEAS YR TOTAL ANOM") {
    throw new Error(NOAA_ONI_SHAPE_ERROR);
  }

  const rows: NoaaOniRow[] = [];
  for (const line of lines.slice(1)) {
    const [seasonText, yearText, totalText, anomalyText] = line.split(/\s+/);
    if (
      seasonText === undefined ||
      !Object.hasOwn(NOAA_ONI_CENTER_MONTHS, seasonText) ||
      yearText === undefined ||
      totalText === undefined ||
      anomalyText === undefined
    ) {
      continue;
    }
    const year = Number(yearText);
    const total = Number(totalText);
    const anomaly = Number(anomalyText);
    if (
      !isNoaaOniSeason(seasonText) ||
      !Number.isInteger(year) ||
      year < 1000 ||
      year > 9999 ||
      !Number.isFinite(total) ||
      !Number.isFinite(anomaly)
    ) {
      continue;
    }
    rows.push({
      season: seasonText,
      year,
      total,
      anomaly,
      phase: noaaOniPhase(anomaly),
    });
  }
  if (lines.length > 1 && rows.length === 0) {
    throw new Error(NOAA_ONI_SHAPE_ERROR);
  }
  return rows;
}

export async function fetchNoaaOni(options: SourceFetchOptions = {}): Promise<NoaaOniRow[]> {
  return parseNoaaOni(await fetchText(NOAA_ONI_URL, options));
}

export function noaaOniDataSource(options: SourceFetchOptions = {}): DataSource<NoaaOniRow> {
  return {
    provider: "noaa-oni",
    dataset: "oceanic-nino-index",
    requestUrls: () => [NOAA_ONI_URL],
    fetchRelease: async (fetchOptions = {}): Promise<DataRelease<NoaaOniRow> | undefined> => {
      const rows = await fetchNoaaOni({ ...options, ...fetchOptions });
      let asOf: string | undefined;
      for (const row of rows) {
        const rowAsOf = noaaOniAsOf(row.season, row.year);
        if (rowAsOf !== undefined && (asOf === undefined || rowAsOf > asOf)) asOf = rowAsOf;
      }
      if (asOf === undefined) return undefined;
      return {
        provider: "noaa-oni",
        dataset: "oceanic-nino-index",
        asOf,
        url: NOAA_ONI_URL,
        rows,
      };
    },
  };
}
