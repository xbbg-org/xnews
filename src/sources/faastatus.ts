import { filterEvents } from "../events.js";
import { fetchText } from "../http.js";
import { cleanText, elementPattern, openTagPattern, stableId } from "../text.js";
import type {
  EventFetchOptions,
  EventRecord,
  EventSeverity,
  EventSnapshot,
  EventSource,
} from "../types.js";
import { FAA_STATUS_DATASET, FAA_STATUS_PROVIDER, FAA_STATUS_URL } from "./faastatus.urls.js";

const FAA_STATUS_SHAPE_ERROR = "unexpected FAA airport status response shape";

type FaaStatusEventType =
  | "Airport_Closure"
  | "Ground_Stop"
  | "Ground_Delay"
  | "Arrival_Departure_Delay";

interface FaaStatusDefinition {
  readonly label: string;
  readonly severity: EventSeverity;
}

const FAA_STATUS_EVENT_TYPES: readonly FaaStatusEventType[] = [
  "Airport_Closure",
  "Ground_Stop",
  "Ground_Delay",
  "Arrival_Departure_Delay",
];

const FAA_STATUS_DEFINITIONS: Readonly<Record<FaaStatusEventType, FaaStatusDefinition>> = {
  Airport_Closure: { label: "airport closure", severity: "extreme" },
  Ground_Stop: { label: "ground stop", severity: "severe" },
  Ground_Delay: { label: "ground delay", severity: "moderate" },
  Arrival_Departure_Delay: { label: "arrival/departure delay", severity: "minor" },
};

export { FAA_STATUS_DATASET, FAA_STATUS_PROVIDER, FAA_STATUS_URL } from "./faastatus.urls.js";

/** Fetches the airport disruptions FAA currently reports. */
export async function fetchFaaStatus(options: EventFetchOptions = {}): Promise<EventRecord[]> {
  return parseFaaStatus(await fetchText(FAA_STATUS_URL, options));
}

/** Parses the FAA XML response into active aviation events. Pure and network-free. */
export function parseFaaStatus(xml: string): EventRecord[] {
  if (!openTagPattern("AIRPORT_STATUS_INFORMATION").test(xml)) {
    throw new Error(FAA_STATUS_SHAPE_ERROR);
  }

  const events: EventRecord[] = [];
  const seenIds = new Set<string>();
  for (const eventType of FAA_STATUS_EVENT_TYPES) {
    const definition = FAA_STATUS_DEFINITIONS[eventType];
    for (const sectionMatch of xml.matchAll(elementPattern(eventType))) {
      const section = sectionMatch[2];
      if (section === undefined) continue;
      const airport = xmlElementText(section, "ARPT")?.toUpperCase();
      if (airport === undefined || airport.length === 0) continue;
      const reason = xmlElementText(section, "Reason") ?? "";
      const average = xmlElementText(section, "Avg");
      const id = stableId([FAA_STATUS_PROVIDER, eventType, airport, reason]);
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const summary = faaStatusSummary(reason, average);
      events.push({
        id,
        provider: FAA_STATUS_PROVIDER,
        category: "aviation",
        title: `${airport} ${definition.label}`,
        severity: definition.severity,
        areaName: airport,
        countryCode: "US",
        eventType,
        ...(summary === undefined ? {} : { summary }),
      });
    }
  }
  return events;
}

/** Binds FAA's current airport status feed to the events lane. */
export function faaStatusSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: FAA_STATUS_PROVIDER,
    dataset: FAA_STATUS_DATASET,
    requestUrls: () => [FAA_STATUS_URL],
    fetchSnapshot: async (fetchOptions = {}): Promise<EventSnapshot | undefined> => {
      const combined = merged(fetchOptions);
      const events = parseFaaStatus(await fetchText(FAA_STATUS_URL, combined));
      const filtered = filterEvents(events, combined);
      if (filtered.length === 0) return undefined;
      return {
        provider: FAA_STATUS_PROVIDER,
        dataset: FAA_STATUS_DATASET,
        observedAt: new Date().toISOString(),
        events: filtered,
        warnings: [],
        requestUrls: [FAA_STATUS_URL],
      };
    },
  };
}

function xmlElementText(xml: string, tag: string): string | undefined {
  const match = elementPattern(tag, "i").exec(xml);
  const body = match?.[2];
  if (body === undefined) return undefined;
  const text = cleanText(body);
  return text.length === 0 ? undefined : text;
}

function faaStatusSummary(reason: string, average: string | undefined): string | undefined {
  if (reason.length === 0) {
    return average === undefined ? undefined : `Average delay: ${average}`;
  }
  return average === undefined ? reason : `${reason}. Average delay: ${average}`;
}
