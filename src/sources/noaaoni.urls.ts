export const NOAA_ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt";

export type NoaaOniSeason =
  | "DJF"
  | "JFM"
  | "FMA"
  | "MAM"
  | "AMJ"
  | "MJJ"
  | "JJA"
  | "JAS"
  | "ASO"
  | "SON"
  | "OND"
  | "NDJ";

/**
 * NOAA assigns each overlapping three-month season to its center month:
 * DJF is January through NDJ as December, all in the published `YR`.
 */
export const NOAA_ONI_CENTER_MONTHS: Record<NoaaOniSeason, number> = {
  DJF: 1,
  JFM: 2,
  FMA: 3,
  MAM: 4,
  AMJ: 5,
  MJJ: 6,
  JJA: 7,
  JAS: 8,
  ASO: 9,
  SON: 10,
  OND: 11,
  NDJ: 12,
};

export function noaaOniAsOf(season: NoaaOniSeason, year: number): string | undefined {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return undefined;
  const month = NOAA_ONI_CENTER_MONTHS[season];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Narrows NOAA's three-letter season label, so a malformed row is skipped rather than mistyped. */
export function isNoaaOniSeason(value: string): value is NoaaOniSeason {
  return Object.hasOwn(NOAA_ONI_CENTER_MONTHS, value);
}
