import { filterEvents } from "../events.js";
import { fetchJsonText } from "../http.js";
import { isRecord, parseJsonRecord, stringField } from "../json.js";
import { SONDEHUB_DATASET, SONDEHUB_PROVIDER, SONDEHUB_TELEMETRY_URL } from "./sondehub.urls.js";
import type { EventFetchOptions, EventRecord, EventSource } from "../types.js";

export { SONDEHUB_DATASET, SONDEHUB_PROVIDER, SONDEHUB_TELEMETRY_URL } from "./sondehub.urls.js";

const SONDEHUB_SHAPE_ERROR = "unexpected SondeHub telemetry response shape";

/** Fetches the latest hour of SondeHub radiosonde telemetry. */
export async function fetchSondeHubTelemetry(
  options: EventFetchOptions = {},
): Promise<EventRecord[]> {
  const body = await fetchJsonText(SONDEHUB_TELEMETRY_URL, options);
  return parseSondeHubTelemetry(body);
}

/**
 * Binds the current SondeHub telemetry set to the active-events lane.
 * Per-call transport and filter options override options bound at creation.
 */
export function sondeHubSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: SONDEHUB_PROVIDER,
    dataset: SONDEHUB_DATASET,
    requestUrls: () => [SONDEHUB_TELEMETRY_URL],
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const events = filterEvents(await fetchSondeHubTelemetry(combined), combined);
      if (events.length === 0) return undefined;
      return {
        provider: SONDEHUB_PROVIDER,
        dataset: SONDEHUB_DATASET,
        observedAt: new Date().toISOString(),
        events,
        warnings: [],
        requestUrls: [SONDEHUB_TELEMETRY_URL],
      };
    },
  };
}

/**
 * Walks SondeHub's serial/timestamp object and emits only the newest frame for
 * each serial. Keeping every frame would turn one balloon into snapshot noise.
 */
export function parseSondeHubTelemetry(body: string): EventRecord[] {
  const serials = parseJsonRecord(body, "SondeHub telemetry");
  if (Array.isArray(serials)) throw new Error(SONDEHUB_SHAPE_ERROR);
  const events: EventRecord[] = [];
  const seenIds = new Set<string>();
  let recognizedSerials = 0;

  for (const [serialKey, timestampEntries] of Object.entries(serials)) {
    if (!isRecord(timestampEntries)) continue;
    recognizedSerials += 1;

    let latest:
      | {
          readonly observedAt: string;
          readonly milliseconds: number;
          readonly frame: Record<string, unknown>;
        }
      | undefined;

    for (const [timestamp, value] of Object.entries(timestampEntries)) {
      if (!isRecord(value)) continue;
      const observedAt = isoInstant(timestamp) ?? isoInstant(stringField(value, "datetime"));
      if (observedAt === undefined) continue;
      const milliseconds = Date.parse(observedAt);
      if (latest === undefined || milliseconds > latest.milliseconds) {
        latest = { observedAt, milliseconds, frame: value };
      }
    }

    if (latest === undefined) continue;
    const serial = serialKey.trim() || stringField(latest.frame, "serial")?.trim();
    if (!serial || seenIds.has(serial)) continue;
    seenIds.add(serial);

    const latitude = finiteNumber(latest.frame["lat"]);
    const longitude = finiteNumber(latest.frame["lon"]);
    const altitude = finiteNumber(latest.frame["alt"]);
    const hasCoordinates =
      latitude !== undefined &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude !== undefined &&
      longitude >= -180 &&
      longitude <= 180;

    events.push({
      id: serial,
      provider: SONDEHUB_PROVIDER,
      category: "atmospheric",
      title: `${serial} radiosonde`,
      // Radiosonde telemetry is an observation, not a hazard ranking.
      severity: "unknown",
      observedAt: latest.observedAt,
      eventType: "radiosonde",
      ...(hasCoordinates ? { latitude, longitude } : {}),
      ...(altitude !== undefined ? { magnitude: altitude, magnitudeUnit: "m" } : {}),
    });
  }

  if (Object.keys(serials).length > 0 && recognizedSerials === 0) {
    throw new Error(SONDEHUB_SHAPE_ERROR);
  }
  return events;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isoInstant(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}
