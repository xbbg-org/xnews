import { normalizeDateOnly } from "../dates.js";

export const DROUGHT_MONITOR_BASE_URL =
  "https://usdmdataservices.unl.edu/api/USStatistics/GetDroughtSeverityStatisticsByAreaPercent";

export interface DroughtMonitorUrlOptions {
  readonly startDate: string | Date;
  readonly endDate: string | Date;
}

/** The USDM API requires unpadded `M/D/YYYY`, rather than an ISO date. */
export function droughtMonitorApiDate(value: string | Date): string {
  const isoDate = normalizeDateOnly(value);
  if (isoDate === null) throw new RangeError("drought monitor date must be a valid ISO date");
  const [year, month, day] = isoDate.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

export function droughtMonitorUrl(options: DroughtMonitorUrlOptions): string {
  const url = new URL(DROUGHT_MONITOR_BASE_URL);
  url.searchParams.set("aoi", "us");
  url.searchParams.set("startdate", droughtMonitorApiDate(options.startDate));
  url.searchParams.set("enddate", droughtMonitorApiDate(options.endDate));
  url.searchParams.set("statisticsType", "1");
  return url.toString();
}
