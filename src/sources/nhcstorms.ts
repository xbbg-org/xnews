import { parsePublishedAt } from "../dates.js";
import { filterEvents } from "../events.js";
import { fetchJsonText } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringField } from "../json.js";
import { cleanText, safeHttpUrl } from "../text.js";
import { NHC_CURRENT_STORMS_URL } from "./nhcstorms.urls.js";
import type { EventFetchOptions, EventRecord, EventSeverity, EventSource } from "../types.js";

const NHC_DATASET = "current-storms";
const NHC_SHAPE_ERROR = "unexpected NHC current storms response shape";

const NHC_CLASSIFICATION_SEVERITIES: Readonly<Record<string, EventSeverity>> = {
  HU: "severe",
  TS: "moderate",
  TD: "minor",
};

export { NHC_CURRENT_STORMS_URL } from "./nhcstorms.urls.js";

export async function fetchNhcStormsEvents(
  options: EventFetchOptions = {},
): Promise<EventRecord[]> {
  const body = await fetchJsonText(NHC_CURRENT_STORMS_URL, options);
  return parseNhcStorms(body);
}

export function nhcStormsSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: "nhc-storms",
    dataset: NHC_DATASET,
    requestUrls: () => [NHC_CURRENT_STORMS_URL],
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const filtered = filterEvents(await fetchNhcStormsEvents(combined), combined);
      if (filtered.length === 0) return undefined;
      return {
        provider: "nhc-storms",
        dataset: NHC_DATASET,
        observedAt: new Date().toISOString(),
        events: filtered,
        warnings: [],
        requestUrls: [NHC_CURRENT_STORMS_URL],
      };
    },
  };
}

/** Parses NHC's current-storm JSON, including hemisphere-suffixed coordinates. */
export function parseNhcStorms(body: string): EventRecord[] {
  const payload = parseJsonRecord(body, "NHC current storms");
  if (!Array.isArray(payload["activeStorms"])) throw new Error(NHC_SHAPE_ERROR);

  const events: EventRecord[] = [];
  const ids = new Set<string>();
  for (const storm of recordArray(payload["activeStorms"])) {
    const id = stringField(storm, "id")?.trim();
    if (!id || ids.has(id)) continue;

    const name = cleanText(stringField(storm, "name") ?? "");
    const classification = stringField(storm, "classification")?.trim().toUpperCase() ?? "";
    const title = name || id;
    const intensityText = stringField(storm, "intensity")?.trim();
    const parsedIntensity =
      intensityText !== undefined && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(intensityText)
        ? Number(intensityText)
        : undefined;
    const intensity =
      parsedIntensity !== undefined && Number.isFinite(parsedIntensity)
        ? parsedIntensity
        : undefined;
    const latitude = hemisphereCoordinate(stringField(storm, "latitude"), "N", "S", 90);
    const longitude = hemisphereCoordinate(stringField(storm, "longitude"), "E", "W", 180);
    const publicAdvisory = storm["publicAdvisory"];
    const advisoryUrl = isRecord(publicAdvisory)
      ? safeHttpUrl(stringField(publicAdvisory, "url")?.trim() ?? "")
      : undefined;
    const lastUpdate = stringField(storm, "lastUpdate");
    const observedAt = lastUpdate ? parsePublishedAt(lastUpdate)?.instant : undefined;
    const severity =
      classification === "MH" || (intensity !== undefined && intensity >= 96)
        ? "extreme"
        : (NHC_CLASSIFICATION_SEVERITIES[classification] ?? "unknown");

    ids.add(id);
    events.push({
      id,
      provider: "nhc-storms",
      category: "weather",
      title,
      severity,
      ...(observedAt ? { observedAt } : {}),
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      ...(intensity !== undefined ? { magnitude: intensity, magnitudeUnit: "kt" } : {}),
      ...(advisoryUrl ? { url: advisoryUrl } : {}),
      ...(classification ? { eventType: classification } : {}),
    });
  }
  return events;
}

function hemisphereCoordinate(
  value: string | undefined,
  positiveSuffix: string,
  negativeSuffix: string,
  maximum: number,
): number | undefined {
  const match = value
    ?.trim()
    .toUpperCase()
    .match(/^(\d+(?:\.\d+)?)\s*([NSEW])$/);
  if (!match) return undefined;
  const magnitude = Number(match[1]);
  const suffix = match[2];
  if (!Number.isFinite(magnitude) || magnitude > maximum) return undefined;
  if (suffix === positiveSuffix) return magnitude;
  if (suffix === negativeSuffix) return -magnitude;
  return undefined;
}
