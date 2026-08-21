import { parsePublishedAt } from "../dates.js";
import { filterEvents } from "../events.js";
import { fetchJsonText } from "../http.js";
import { isRecord, stringField } from "../json.js";
import { cleanText } from "../text.js";
import {
  USGS_ELEVATED_VOLCANOES_URL,
  gvpVolcanoCoordinatesUrl,
  usgsVolcanoUrl,
} from "./usgsvolcanoes.urls.js";
import type { EventFetchOptions, EventRecord, EventSeverity, EventSource } from "../types.js";

const USGS_VOLCANO_SHAPE_ERROR = "unexpected USGS elevated-volcano response shape";
const GVP_VOLCANO_SHAPE_ERROR = "unexpected Smithsonian GVP WFS response shape";

const VOLCANO_ALERT_SEVERITY: Readonly<Record<string, EventSeverity>> = {
  WARNING: "extreme",
  WATCH: "severe",
  ADVISORY: "moderate",
  NORMAL: "minor",
};

export {
  GVP_VOLCANO_TYPE_NAME,
  GVP_VOLCANO_WFS_URL,
  USGS_ELEVATED_VOLCANOES_URL,
  gvpVolcanoCoordinatesUrl,
  usgsVolcanoUrl,
} from "./usgsvolcanoes.urls.js";

export interface UsgsVolcanoAlert {
  readonly name: string;
  readonly volcanoNumber: string;
  readonly alertLevel: string;
  readonly colorCode: string;
  readonly observatory?: string;
  readonly observedAt?: string;
}

export interface UsgsVolcanoCoordinate {
  readonly volcanoNumber: string;
  readonly latitude: number;
  readonly longitude: number;
}

/** Parses the USGS alert list without applying the optional GVP enrichment. */
export function parseUsgsVolcanoAlerts(body: string): UsgsVolcanoAlert[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(USGS_VOLCANO_SHAPE_ERROR);
  }
  if (!Array.isArray(parsed)) throw new Error(USGS_VOLCANO_SHAPE_ERROR);

  const alerts: UsgsVolcanoAlert[] = [];
  for (const value of parsed) {
    if (!isRecord(value)) continue;
    const name = cleanText(stringField(value, "volcano_name") ?? "");
    const volcanoNumber = normalizedVolcanoNumber(value["volcano_number"] ?? value["vnum"]);
    if (!name || volcanoNumber === undefined) continue;

    const alertLevel = cleanText(stringField(value, "alert_level") ?? "").toUpperCase();
    const colorCode = cleanText(stringField(value, "color_code") ?? "").toUpperCase();
    const observatoryName = cleanText(
      stringField(value, "observatory") ?? stringField(value, "obs_fullname") ?? "",
    );
    const observatoryCode = cleanText(stringField(value, "obs_abbr") ?? "").toUpperCase();
    const observatory = observatoryName
      ? `${observatoryName}${observatoryCode ? ` (${observatoryCode})` : ""}`
      : observatoryCode;
    const observedAt = usgsObservedAt(stringField(value, "sent_utc"));
    alerts.push({
      name,
      volcanoNumber,
      alertLevel,
      colorCode,
      ...(observatory ? { observatory } : {}),
      ...(observedAt ? { observedAt } : {}),
    });
  }
  if (parsed.length > 0 && alerts.length === 0) throw new Error(USGS_VOLCANO_SHAPE_ERROR);
  return alerts;
}

/** Parses the GeoJSON point features returned by the Smithsonian WFS. */
export function parseUsgsVolcanoCoordinates(body: string): UsgsVolcanoCoordinate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(GVP_VOLCANO_SHAPE_ERROR);
  }
  if (!isRecord(parsed)) throw new Error(GVP_VOLCANO_SHAPE_ERROR);
  const features = parsed["features"];
  if (!Array.isArray(features)) throw new Error(GVP_VOLCANO_SHAPE_ERROR);

  const coordinates: UsgsVolcanoCoordinate[] = [];
  for (const feature of features) {
    if (!isRecord(feature)) continue;
    const properties = feature["properties"];
    const geometry = feature["geometry"];
    if (!isRecord(properties) || !isRecord(geometry)) continue;
    const volcanoNumber = normalizedVolcanoNumber(properties["Volcano_Number"]);
    const point = geometry["coordinates"];
    if (volcanoNumber === undefined || !Array.isArray(point)) continue;
    const longitude = point[0];
    const latitude = point[1];
    if (
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      continue;
    }
    coordinates.push({ volcanoNumber, latitude, longitude });
  }
  if (features.length > 0 && coordinates.length === 0) {
    throw new Error(GVP_VOLCANO_SHAPE_ERROR);
  }
  return coordinates;
}

/** Purely joins the alert list to optional GVP coordinates. */
export function parseUsgsVolcanoEvents(alertBody: string, coordinateBody?: string): EventRecord[] {
  const alerts = parseUsgsVolcanoAlerts(alertBody);
  const coordinates = coordinateBody ? parseUsgsVolcanoCoordinates(coordinateBody) : [];
  return volcanoEvents(alerts, coordinates);
}

/** Fetches the current alert set, enriching coordinates when GVP is available. */
export async function fetchUsgsVolcanoEvents(
  options: EventFetchOptions = {},
): Promise<EventRecord[]> {
  return (await fetchUsgsVolcanoState(options)).events;
}

/** Binds USGS elevated-volcano alerts to the generic events lane. */
export function usgsVolcanoesSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: "usgs-volcanoes",
    dataset: "elevated-volcanoes",
    requestUrls: () => [USGS_ELEVATED_VOLCANOES_URL],
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const fetched = await fetchUsgsVolcanoState(combined);
      const events = filterEvents(fetched.events, combined);
      if (events.length === 0 && fetched.warnings.length === 0) return undefined;
      return {
        provider: "usgs-volcanoes",
        dataset: "elevated-volcanoes",
        observedAt: new Date().toISOString(),
        events,
        warnings: fetched.warnings,
        requestUrls: fetched.requestUrls,
      };
    },
  };
}

interface UsgsVolcanoFetchState {
  readonly events: EventRecord[];
  readonly warnings: readonly string[];
  readonly requestUrls: readonly string[];
}

async function fetchUsgsVolcanoState(options: EventFetchOptions): Promise<UsgsVolcanoFetchState> {
  const alertBody = await fetchJsonText(USGS_ELEVATED_VOLCANOES_URL, options);
  const alerts = parseUsgsVolcanoAlerts(alertBody);
  const coordinateUrl = gvpVolcanoCoordinatesUrl(alerts.map((alert) => alert.volcanoNumber));
  const requestUrls = [USGS_ELEVATED_VOLCANOES_URL];
  const warnings: string[] = [];
  let coordinates: readonly UsgsVolcanoCoordinate[] = [];
  if (coordinateUrl !== undefined) {
    requestUrls.push(coordinateUrl);
    try {
      coordinates = parseUsgsVolcanoCoordinates(await fetchJsonText(coordinateUrl, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Smithsonian GVP coordinate enrichment failed: ${message}`);
    }
  }

  return {
    events: volcanoEvents(alerts, coordinates),
    warnings,
    requestUrls,
  };
}

function volcanoEvents(
  alerts: readonly UsgsVolcanoAlert[],
  coordinates: readonly UsgsVolcanoCoordinate[],
): EventRecord[] {
  const coordinatesByNumber = new Map(
    coordinates.map((coordinate) => [coordinate.volcanoNumber, coordinate] as const),
  );
  const events: EventRecord[] = [];
  const seenVolcanoNumbers = new Set<string>();
  for (const alert of alerts) {
    if (seenVolcanoNumbers.has(alert.volcanoNumber)) continue;
    seenVolcanoNumbers.add(alert.volcanoNumber);
    const coordinate = coordinatesByNumber.get(alert.volcanoNumber);
    const eventType = [
      alert.alertLevel ? `${alert.alertLevel} volcano alert` : "Unclassified volcano alert",
      alert.colorCode ? `${alert.colorCode} aviation color code` : "",
    ]
      .filter(Boolean)
      .join("; ");
    events.push({
      id: `usgs-volcanoes-${alert.volcanoNumber}`,
      provider: "usgs-volcanoes",
      category: "hazard",
      title: `${alert.name}: ${eventType}`,
      severity: VOLCANO_ALERT_SEVERITY[alert.alertLevel] ?? "unknown",
      url: usgsVolcanoUrl(alert.name),
      eventType,
      areaName: alert.name,
      ...(alert.observatory ? { summary: `Reported by ${alert.observatory}.` } : {}),
      ...(alert.observedAt ? { observedAt: alert.observedAt } : {}),
      ...(coordinate ? { latitude: coordinate.latitude, longitude: coordinate.longitude } : {}),
    });
  }
  return events;
}

function normalizedVolcanoNumber(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return /^\d+$/.test(normalized) ? normalized : undefined;
}

function usgsObservedAt(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())
    ? `${value.trim().replace(" ", "T")}Z`
    : value;
  return parsePublishedAt(normalized)?.instant;
}
