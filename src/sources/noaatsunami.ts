import { filterEvents } from "../events.js";
import { fetchText } from "../http.js";
import { stableId } from "../text.js";
import { parseAtomEntries } from "../xml.js";
import { NOAA_TSUNAMI_ATOM_URLS } from "./noaatsunami.urls.js";
import type { EventFetchOptions, EventRecord, EventSeverity, EventSource } from "../types.js";

export {
  NOAA_TSUNAMI_ATOM_URLS,
  NOAA_TSUNAMI_PAAQ_ATOM_URL,
  NOAA_TSUNAMI_PHEB_ATOM_URL,
} from "./noaatsunami.urls.js";

/** Parses one warning center's Atom feed through the shared XML parser. */
export function parseNoaaTsunamiAtom(body: string): EventRecord[] {
  const entries = parseAtomEntries(body, {
    // The shared Atom parser produces an intermediate NewsItem and therefore
    // requires a news-lane provider. Its provider is replaced below and never
    // escapes this module.
    provider: "who-outbreaks",
    kind: "unknown",
    sourceFallback: "NOAA Tsunami Warning Centers",
  });
  return entries.map<EventRecord>((entry) => {
    const classification = tsunamiClassification(entry.title);
    return {
      id: stableId(["noaa-tsunami", entry.id]),
      provider: "noaa-tsunami",
      category: "hazard",
      title: entry.title,
      severity: classification.severity,
      url: entry.url,
      ...(entry.summary ? { summary: entry.summary } : {}),
      ...(entry.publishedAt ? { observedAt: entry.publishedAt } : {}),
      ...(classification.eventType ? { eventType: classification.eventType } : {}),
    };
  });
}

/** Merges both centers while guaranteeing the event-lane unique-id invariant. */
export function parseNoaaTsunamiEvents(atomBodies: readonly string[]): EventRecord[] {
  const events: EventRecord[] = [];
  const seenIds = new Set<string>();
  for (const body of atomBodies) {
    for (const event of parseNoaaTsunamiAtom(body)) {
      // This removes only identical derived Atom messages. Distinct PAAQ and
      // PHEB products about the same earthquake have distinct text or URLs and
      // remain separate; semantic cross-center matching would discard messages.
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      events.push(event);
    }
  }
  return events;
}

/** Fetches and merges both NOAA warning-center Atom feeds. */
export async function fetchNoaaTsunamiEvents(
  options: EventFetchOptions = {},
): Promise<EventRecord[]> {
  const bodies = await Promise.all(NOAA_TSUNAMI_ATOM_URLS.map((url) => fetchText(url, options)));
  return parseNoaaTsunamiEvents(bodies);
}

/** Binds both NOAA warning-center feeds to the generic events lane. */
export function noaaTsunamiSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: "noaa-tsunami",
    dataset: "warning-center-messages",
    requestUrls: () => NOAA_TSUNAMI_ATOM_URLS,
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const events = filterEvents(await fetchNoaaTsunamiEvents(combined), combined);
      if (events.length === 0) return undefined;
      return {
        provider: "noaa-tsunami",
        dataset: "warning-center-messages",
        observedAt: new Date().toISOString(),
        events,
        warnings: [],
        requestUrls: [...NOAA_TSUNAMI_ATOM_URLS],
      };
    },
  };
}

function tsunamiClassification(title: string): {
  readonly severity: EventSeverity;
  readonly eventType?: string;
} {
  if (/warning/i.test(title)) return { severity: "extreme", eventType: "Warning" };
  if (/watch/i.test(title)) return { severity: "severe", eventType: "Watch" };
  if (/advisory/i.test(title)) return { severity: "moderate", eventType: "Advisory" };
  if (/information|statement/i.test(title)) {
    return { severity: "minor", eventType: "Information statement" };
  }
  return { severity: "unknown" };
}
