import { normalizeDateOnly } from "../dates.js";
import { filterEvents } from "../events.js";
import { fetchJsonText } from "../http.js";
import { isRecord } from "../json.js";
import {
  GLOFAS_BASINS,
  GLOFAS_FORECAST_DAYS,
  GLOFAS_PAST_DAYS,
  glofasBasinSlug,
  glofasFloodUrl,
} from "./glofasflood.urls.js";
import type { EventFetchOptions, EventRecord, EventSeverity, EventSource } from "../types.js";
import type { GlofasBasin } from "./glofasflood.urls.js";

const GLOFAS_SHAPE_ERROR = "unexpected Open-Meteo GloFAS flood response shape";

/**
 * XNEWS-DERIVED HEURISTIC — NOT AN OFFICIAL GLOFAS CLASSIFICATION.
 *
 * These thresholds classify the ratio of a basin's 31-day forecast peak to
 * its preceding 31-day median. Neither GloFAS nor Open-Meteo publishes these
 * severity labels; attributing the resulting severity to them is false.
 */
export const GLOFAS_XNEWS_MODERATE_RATIO = 1.5;
export const GLOFAS_XNEWS_SEVERE_RATIO = 2;
export const GLOFAS_XNEWS_EXTREME_RATIO = 3;

export {
  GLOFAS_BASINS,
  GLOFAS_FLOOD_API_URL,
  GLOFAS_FORECAST_DAYS,
  GLOFAS_PAST_DAYS,
  glofasBasinSlug,
  glofasFloodUrl,
} from "./glofasflood.urls.js";
export type { GlofasBasin } from "./glofasflood.urls.js";

export interface GlofasFloodOptions extends EventFetchOptions {
  /** Overrides the default registry while retaining one batched API request. */
  readonly basins?: readonly GlofasBasin[];
}

/**
 * Applies xnews's discharge-ratio heuristic. This is not a GloFAS severity
 * function: its result must never be represented as a publisher classification.
 */
export function glofasSeverityForRatio(ratio: number): EventSeverity {
  if (!Number.isFinite(ratio) || ratio < 0) return "unknown";
  if (ratio >= GLOFAS_XNEWS_EXTREME_RATIO) return "extreme";
  if (ratio >= GLOFAS_XNEWS_SEVERE_RATIO) return "severe";
  if (ratio >= GLOFAS_XNEWS_MODERATE_RATIO) return "moderate";
  return "minor";
}

/**
 * Parses either the batched array response or Open-Meteo's bare object for a
 * single requested location. `forecastStartDate` makes the history/forecast
 * boundary explicit; without it, the final 31 daily values are the forecast.
 */
export function parseGlofasFloodEvents(
  body: string,
  basins: readonly GlofasBasin[] = GLOFAS_BASINS,
  forecastStartDate?: string,
): EventRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(GLOFAS_SHAPE_ERROR);
  }
  let points: readonly unknown[];
  if (Array.isArray(parsed)) {
    // An empty collection is a legitimate no-data response; a nonempty batch
    // must preserve the API's one-result-per-requested-location contract.
    if (parsed.length > 0 && parsed.length !== basins.length) {
      throw new Error(GLOFAS_SHAPE_ERROR);
    }
    points = parsed;
  } else if (isRecord(parsed)) {
    if (basins.length !== 1) throw new Error(GLOFAS_SHAPE_ERROR);
    points = [parsed];
  } else {
    throw new Error(GLOFAS_SHAPE_ERROR);
  }

  const events: EventRecord[] = [];
  const eventIds = new Set<string>();
  let recognizedPoints = 0;
  for (let index = 0; index < points.length; index += 1) {
    const basin = basins[index];
    const point = points[index];
    if (basin === undefined || !isRecord(point)) continue;
    const parsedPoint = parseGlofasPoint(point, basin, forecastStartDate);
    if (!parsedPoint.recognized) continue;
    recognizedPoints += 1;
    if (parsedPoint.event === undefined) continue;
    if (eventIds.has(parsedPoint.event.id)) {
      throw new RangeError("GloFAS basin names must produce unique event ids");
    }
    eventIds.add(parsedPoint.event.id);
    events.push(parsedPoint.event);
  }
  if (points.length > 0 && recognizedPoints === 0) throw new Error(GLOFAS_SHAPE_ERROR);
  return events;
}

/** Fetches the one batched major-basin flood request. */
export async function fetchGlofasFloodEvents(
  options: GlofasFloodOptions = {},
): Promise<EventRecord[]> {
  const basins = options.basins ?? GLOFAS_BASINS;
  if (basins.length === 0) return [];

  const url = glofasFloodUrl(basins);
  const forecastStartDate = new Date().toISOString().slice(0, 10);
  return parseGlofasFloodEvents(await fetchJsonText(url, options), basins, forecastStartDate);
}

/** Binds one batched major-basin request to the generic events lane. */
export function glofasFloodSource(options: GlofasFloodOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): GlofasFloodOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: "glofas-flood",
    dataset: "major-basin-outlook",
    requestUrls: () => {
      const basins = options.basins ?? GLOFAS_BASINS;
      return basins.length === 0 ? [] : [glofasFloodUrl(basins)];
    },
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const basins = combined.basins ?? GLOFAS_BASINS;
      const events = filterEvents(await fetchGlofasFloodEvents(combined), combined);
      if (events.length === 0) return undefined;
      return {
        provider: "glofas-flood",
        dataset: "major-basin-outlook",
        observedAt: new Date().toISOString(),
        events,
        warnings: [],
        requestUrls: [glofasFloodUrl(basins)],
      };
    },
  };
}

interface ParsedGlofasPoint {
  readonly recognized: boolean;
  readonly event?: EventRecord;
}

function parseGlofasPoint(
  point: Record<string, unknown>,
  basin: GlofasBasin,
  forecastStartDate: string | undefined,
): ParsedGlofasPoint {
  const daily = point["daily"];
  if (!isRecord(daily)) return { recognized: false };
  const times = daily["time"];
  const discharge = daily["river_discharge"];
  if (!Array.isArray(times) || !Array.isArray(discharge)) return { recognized: false };

  const observations: Array<{ readonly day: string; readonly discharge: number }> = [];
  const observationCount = Math.min(times.length, discharge.length);
  for (let index = 0; index < observationCount; index += 1) {
    const day = times[index];
    const value = discharge[index];
    if (typeof day !== "string" || typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value < 0) continue;
    observations.push({ day, discharge: value });
  }
  if (observations.length === 0) return { recognized: true };

  const boundary =
    forecastStartDate === undefined
      ? undefined
      : (normalizeDateOnly(forecastStartDate) ?? undefined);
  const splitIndex = Math.max(0, observations.length - GLOFAS_FORECAST_DAYS);
  const past = (
    boundary === undefined
      ? observations.slice(0, splitIndex)
      : observations.filter((observation) => observation.day < boundary)
  ).slice(-GLOFAS_PAST_DAYS);
  const forecast = (
    boundary === undefined
      ? observations.slice(splitIndex)
      : observations.filter((observation) => observation.day >= boundary)
  ).slice(0, GLOFAS_FORECAST_DAYS);
  if (forecast.length === 0) return { recognized: true };

  let peak = forecast[0];
  if (peak === undefined) return { recognized: true };
  for (const observation of forecast.slice(1)) {
    if (observation.discharge > peak.discharge) peak = observation;
  }

  const baseline = past.length === 0 ? undefined : median(past.map((item) => item.discharge));
  const ratio = baseline !== undefined && baseline > 0 ? peak.discharge / baseline : undefined;
  const severity = ratio === undefined ? "unknown" : glofasSeverityForRatio(ratio);
  const peakDate = normalizeDateOnly(peak.day);
  const summary =
    ratio === undefined
      ? `Forecast peak ${peak.discharge} m3/s. xnews could not derive a ratio from a positive ` +
        "past-31-day median, so severity is unknown; this is not an official GloFAS classification."
      : `Forecast peak ${peak.discharge} m3/s is ${ratio.toFixed(2)}x the past-31-day median. ` +
        "Severity is an xnews-derived heuristic, not an official GloFAS classification.";

  return {
    recognized: true,
    event: {
      id: `glofas-${glofasBasinSlug(basin.name)}`,
      provider: "glofas-flood",
      category: "flood",
      title: `${basin.name} flood outlook`,
      severity,
      summary,
      eventType: "xnews discharge-ratio heuristic",
      areaName: basin.name,
      magnitude: peak.discharge,
      magnitudeUnit: "m3/s",
      ...(basin.countryCode ? { countryCode: basin.countryCode } : {}),
      ...(Number.isFinite(basin.latitude) ? { latitude: basin.latitude } : {}),
      ...(Number.isFinite(basin.longitude) ? { longitude: basin.longitude } : {}),
      ...(peakDate ? { startsAt: `${peakDate}T00:00:00.000Z` } : {}),
    },
  };
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return Number.NaN;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}
