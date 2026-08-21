import { parsePublishedAt } from "../dates.js";
import { filterEvents } from "../events.js";
import { fetchJsonText } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringField } from "../json.js";
import { cleanText, safeHttpUrl, stripTags } from "../text.js";
import { GDACS_EVENTS_URL } from "./gdacs.urls.js";
import type {
  EventCategory,
  EventFetchOptions,
  EventRecord,
  EventSeverity,
  EventSource,
} from "../types.js";

const GDACS_DATASET = "event-list";
const GDACS_SHAPE_ERROR = "unexpected GDACS event list response shape";

const GDACS_ALERT_SEVERITIES: Readonly<Record<string, EventSeverity>> = {
  Red: "extreme",
  Orange: "severe",
  Green: "minor",
};

const GDACS_CATEGORIES: Readonly<Record<string, EventCategory>> = {
  EQ: "seismic",
  TC: "weather",
  FL: "flood",
  VO: "hazard",
  DR: "hazard",
  WF: "hazard",
  TS: "hazard",
};

export { GDACS_EVENTS_URL } from "./gdacs.urls.js";

export async function fetchGdacsEvents(options: EventFetchOptions = {}): Promise<EventRecord[]> {
  const body = await fetchJsonText(GDACS_EVENTS_URL, options);
  return parseGdacs(body);
}

export function gdacsSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: "gdacs",
    dataset: GDACS_DATASET,
    requestUrls: () => [GDACS_EVENTS_URL],
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const filtered = filterEvents(await fetchGdacsEvents(combined), combined);
      if (filtered.length === 0) return undefined;
      return {
        provider: "gdacs",
        dataset: GDACS_DATASET,
        observedAt: new Date().toISOString(),
        events: filtered,
        warnings: [],
        requestUrls: [GDACS_EVENTS_URL],
      };
    },
  };
}

/** Parses the active GDACS GeoJSON event list without performing network I/O. */
export function parseGdacs(body: string): EventRecord[] {
  const payload = parseJsonRecord(body, "GDACS event list");
  if (!Array.isArray(payload["features"])) throw new Error(GDACS_SHAPE_ERROR);

  const events: EventRecord[] = [];
  const ids = new Set<string>();
  for (const feature of recordArray(payload["features"])) {
    const properties = feature["properties"];
    if (!isRecord(properties)) continue;

    const rawEventId = properties["eventid"];
    const eventId =
      typeof rawEventId === "string"
        ? rawEventId.trim()
        : typeof rawEventId === "number" && Number.isFinite(rawEventId)
          ? String(rawEventId)
          : "";
    const eventType = stringField(properties, "eventtype")?.trim().toUpperCase() ?? "";
    if (!eventId || !eventType) continue;

    const id = `gdacs-${eventType}-${eventId}`;
    if (ids.has(id)) continue;

    const eventName = cleanText(stringField(properties, "eventname") ?? "");
    const description = cleanText(stripTags(stringField(properties, "htmldescription") ?? ""));
    const severityData = properties["severitydata"];
    const severityText = isRecord(severityData)
      ? cleanText(stringField(severityData, "severitytext") ?? "")
      : "";
    const summary = description || severityText;
    const startsText = stringField(properties, "fromdate");
    const endsText = stringField(properties, "todate");
    const startsAt = startsText ? parsePublishedAt(startsText)?.instant : undefined;
    const endsAt = endsText ? parsePublishedAt(endsText)?.instant : undefined;
    const report = properties["url"];
    const reportUrl = isRecord(report)
      ? safeHttpUrl(stringField(report, "report")?.trim() ?? "")
      : undefined;
    const coordinates = gdacsCoordinates(feature["geometry"]);
    const areaName = cleanText(stringField(properties, "country") ?? "");

    ids.add(id);
    events.push({
      id,
      provider: "gdacs",
      category: GDACS_CATEGORIES[eventType] ?? "unknown",
      // GDACS leaves `eventname` empty for most floods and droughts, so the
      // rendered description is a far better headline than a bare type+id.
      title: eventName || summary || `${eventType} ${eventId}`,
      severity:
        GDACS_ALERT_SEVERITIES[stringField(properties, "alertlevel")?.trim() ?? ""] ?? "unknown",
      ...(summary ? { summary } : {}),
      ...(reportUrl ? { url: reportUrl } : {}),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
      ...coordinates,
      // GDACS supplies ISO-3 in `iso3`, while this lane promises ISO-2.
      // Keep the country name as the area rather than publish a mislabeled code.
      ...(areaName ? { areaName } : {}),
      eventType,
    });
  }
  return events;
}

function gdacsCoordinates(
  geometry: unknown,
): { readonly longitude: number; readonly latitude: number } | undefined {
  if (!isRecord(geometry) || stringField(geometry, "type") !== "Point") return undefined;
  const coordinates = geometry["coordinates"];
  if (!Array.isArray(coordinates)) return undefined;
  const longitude = coordinates[0];
  const latitude = coordinates[1];
  return typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90
    ? { longitude, latitude }
    : undefined;
}
