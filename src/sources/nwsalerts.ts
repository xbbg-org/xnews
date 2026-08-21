import { parsePublishedAt } from "../dates.js";
import { filterEvents } from "../events.js";
import { fetchJsonText } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringField } from "../json.js";
import { cleanText } from "../text.js";
import { NWS_ALERTS_URL } from "./nwsalerts.urls.js";
import type {
  EventCategory,
  EventFetchOptions,
  EventRecord,
  EventSeverity,
  EventSource,
} from "../types.js";

const NWS_DATASET = "active-alerts";
const NWS_USER_AGENT = "xnews weather alerts (+https://github.com/xbbg-org/xnews)";
const NWS_SHAPE_ERROR = "unexpected NWS alerts response shape";

const NWS_SEVERITIES: Readonly<Record<string, EventSeverity>> = {
  Extreme: "extreme",
  Severe: "severe",
  Moderate: "moderate",
  Minor: "minor",
  Unknown: "unknown",
};

const NON_METEOROLOGICAL_EVENTS: Readonly<Record<string, true>> = {
  "Civil Emergency": true,
  "Civil Emergency Message": true,
  "Hazardous Materials": true,
  "Hazardous Materials Warning": true,
  "Nuclear Power Plant Warning": true,
};

export { NWS_ALERTS_URL } from "./nwsalerts.urls.js";

export async function fetchNwsAlertsEvents(
  options: EventFetchOptions = {},
): Promise<EventRecord[]> {
  const body = await fetchJsonText(NWS_ALERTS_URL, options, options.userAgent ?? NWS_USER_AGENT);
  return parseNwsAlerts(body);
}

export function nwsAlertsSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: "nws-alerts",
    dataset: NWS_DATASET,
    requestUrls: () => [NWS_ALERTS_URL],
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const filtered = filterEvents(await fetchNwsAlertsEvents(combined), combined);
      if (filtered.length === 0) return undefined;
      return {
        provider: "nws-alerts",
        dataset: NWS_DATASET,
        observedAt: new Date().toISOString(),
        events: filtered,
        warnings: [],
        requestUrls: [NWS_ALERTS_URL],
      };
    },
  };
}

/** Parses the active NWS GeoJSON feed without performing network I/O. */
export function parseNwsAlerts(body: string): EventRecord[] {
  const payload = parseJsonRecord(body, "NWS alerts");
  if (!Array.isArray(payload["features"])) throw new Error(NWS_SHAPE_ERROR);

  const events: EventRecord[] = [];
  const ids = new Set<string>();
  for (const feature of recordArray(payload["features"])) {
    const id = stringField(feature, "id")?.trim();
    const properties = feature["properties"];
    if (!id || ids.has(id) || !isRecord(properties)) continue;

    const eventType = cleanText(stringField(properties, "event") ?? "");
    const headline = cleanText(stringField(properties, "headline") ?? "");
    const title = headline || eventType;
    if (!title) continue;

    const summary = cleanText(stringField(properties, "description") ?? "");
    const areaName = cleanText(stringField(properties, "areaDesc") ?? "");
    const startsText = stringField(properties, "onset") ?? stringField(properties, "effective");
    const endsText = stringField(properties, "expires");
    const startsAt = startsText ? parsePublishedAt(startsText)?.instant : undefined;
    const endsAt = endsText ? parsePublishedAt(endsText)?.instant : undefined;
    const centroid = geometryCentroid(feature["geometry"]);

    ids.add(id);
    events.push({
      id,
      provider: "nws-alerts",
      category: nwsCategory(eventType),
      title,
      severity: NWS_SEVERITIES[stringField(properties, "severity")?.trim() ?? ""] ?? "unknown",
      countryCode: "US",
      ...(summary ? { summary } : {}),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
      ...(areaName ? { areaName } : {}),
      ...(eventType ? { eventType } : {}),
      // Zone-only alerts deliberately carry no coordinates: inventing a point
      // would make an administrative coverage area look like a measured site.
      ...centroid,
    });
  }
  return events;
}

function nwsCategory(eventType: string): EventCategory {
  if (NON_METEOROLOGICAL_EVENTS[eventType] === true) return "hazard";
  return /\bflood\b/i.test(eventType) ? "flood" : "weather";
}

interface PolygonCentroid {
  readonly longitude: number;
  readonly latitude: number;
  readonly weight: number;
}

function geometryCentroid(geometry: unknown): Omit<PolygonCentroid, "weight"> | undefined {
  if (!isRecord(geometry)) return undefined;
  const type = stringField(geometry, "type");
  const coordinates = geometry["coordinates"];
  if (!Array.isArray(coordinates)) return undefined;

  if (type === "Polygon") {
    const centroid = polygonCentroid(coordinates);
    return centroid ? { longitude: centroid.longitude, latitude: centroid.latitude } : undefined;
  }
  if (type !== "MultiPolygon") return undefined;

  let longitude = 0;
  let latitude = 0;
  let weight = 0;
  for (const polygon of coordinates) {
    if (!Array.isArray(polygon)) return undefined;
    const centroid = polygonCentroid(polygon);
    if (!centroid) return undefined;
    longitude += centroid.longitude * centroid.weight;
    latitude += centroid.latitude * centroid.weight;
    weight += centroid.weight;
  }
  return weight > 0 ? { longitude: longitude / weight, latitude: latitude / weight } : undefined;
}

function polygonCentroid(rings: readonly unknown[]): PolygonCentroid | undefined {
  let longitudeMoment = 0;
  let latitudeMoment = 0;
  let signedArea = 0;
  for (const ring of rings) {
    const centroid = ringCentroid(ring);
    if (!centroid) return undefined;
    longitudeMoment += centroid.longitude * centroid.weight;
    latitudeMoment += centroid.latitude * centroid.weight;
    signedArea += centroid.weight;
  }
  if (signedArea === 0) return undefined;
  return {
    longitude: longitudeMoment / signedArea,
    latitude: latitudeMoment / signedArea,
    weight: Math.abs(signedArea),
  };
}

function ringCentroid(value: unknown): PolygonCentroid | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const points: (readonly [number, number])[] = [];
  for (const valuePoint of value) {
    const point = coordinatePair(valuePoint);
    if (!point) return undefined;
    points.push(point);
  }

  let twiceArea = 0;
  let longitudeMoment = 0;
  let latitudeMoment = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    longitudeMoment += (current[0] + next[0]) * cross;
    latitudeMoment += (current[1] + next[1]) * cross;
  }
  if (twiceArea === 0) return undefined;
  return {
    longitude: longitudeMoment / (3 * twiceArea),
    latitude: latitudeMoment / (3 * twiceArea),
    weight: twiceArea / 2,
  };
}

function coordinatePair(value: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(value)) return undefined;
  const longitude = value[0];
  const latitude = value[1];
  return typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90
    ? [longitude, latitude]
    : undefined;
}
