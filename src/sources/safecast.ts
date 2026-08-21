import { filterEvents } from "../events.js";
import { fetchJsonText } from "../http.js";
import { isRecord, stringField } from "../json.js";
import { SAFECAST_DATASET, SAFECAST_MEASUREMENTS_URL, SAFECAST_PROVIDER } from "./safecast.urls.js";
import type { EventFetchOptions, EventRecord, EventSource } from "../types.js";

export { SAFECAST_DATASET, SAFECAST_MEASUREMENTS_URL, SAFECAST_PROVIDER } from "./safecast.urls.js";

const SAFECAST_SHAPE_ERROR = "unexpected Safecast measurements response shape";

/** Fetches and parses Safecast's newest public measurements. */
export async function fetchSafecastMeasurements(
  options: EventFetchOptions = {},
): Promise<EventRecord[]> {
  const body = await fetchJsonText(SAFECAST_MEASUREMENTS_URL, options);
  return parseSafecastMeasurements(body);
}

/**
 * Binds Safecast measurements to the active-events lane.
 * Per-call transport and filter options override options bound at creation.
 */
export function safecastSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: SAFECAST_PROVIDER,
    dataset: SAFECAST_DATASET,
    requestUrls: () => [SAFECAST_MEASUREMENTS_URL],
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const events = filterEvents(await fetchSafecastMeasurements(combined), combined);
      if (events.length === 0) return undefined;
      return {
        provider: SAFECAST_PROVIDER,
        dataset: SAFECAST_DATASET,
        observedAt: new Date().toISOString(),
        events,
        warnings: [],
        requestUrls: [SAFECAST_MEASUREMENTS_URL],
      };
    },
  };
}

/** Parses the bare measurement array. Pure and network-free. */
export function parseSafecastMeasurements(body: string): EventRecord[] {
  const seenIds = new Set<string>();
  const records = parseSafecastRecords(body);
  const events: EventRecord[] = [];

  for (const record of records) {
    const latitude = coordinate(record["latitude"], -90, 90);
    const longitude = coordinate(record["longitude"], -180, 180);
    if (latitude === undefined || longitude === undefined) continue;

    const id = identifier(record["id"]);
    if (id === undefined || seenIds.has(id)) continue;
    seenIds.add(id);

    const magnitude = finiteNumber(record["value"]);
    const unit = stringField(record, "unit")?.trim();
    const areaName = stringField(record, "location_name")?.trim();
    const observedAt = isoInstant(stringField(record, "captured_at"));

    events.push({
      id,
      provider: SAFECAST_PROVIDER,
      category: "radiation",
      title: areaName ? `Safecast measurement at ${areaName}` : `Safecast measurement ${id}`,
      // Counts per minute depend on detector geometry and efficiency and cannot
      // be treated as a dose rate. Keeping every reading unranked avoids an
      // xnews-invented hazard threshold, including for mixed-unit snapshots.
      severity: "unknown",
      latitude,
      longitude,
      ...(magnitude !== undefined ? { magnitude } : {}),
      ...(unit ? { magnitudeUnit: unit } : {}),
      ...(observedAt ? { observedAt } : {}),
      ...(areaName ? { areaName } : {}),
    });
  }

  return events;
}

function parseSafecastRecords(body: string): readonly Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(SAFECAST_SHAPE_ERROR);
  }
  if (!Array.isArray(parsed)) throw new Error(SAFECAST_SHAPE_ERROR);
  const records = parsed.filter(isRecord);
  if (parsed.length > 0 && records.length === 0) throw new Error(SAFECAST_SHAPE_ERROR);
  return records;
}

function identifier(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coordinate(value: unknown, minimum: number, maximum: number): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function isoInstant(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}
