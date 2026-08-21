/** GDELT v2 event-stream distribution; distinct from the DOC 2.0 article-search API. */
export const GDELT_EVENTS_BASE_URL = "https://data.gdeltproject.org/gdeltv2/";
export const GDELT_EVENTS_LAST_UPDATE_URL = `${GDELT_EVENTS_BASE_URL}lastupdate.txt`;
export const GDELT_EVENTS_DATASET = "gdelt-v2-events";

/**
 * Zero-based fields in the headerless, tab-separated GDELT 2.0 event export.
 * Names follow the publisher's Event Codebook so schema offsets stay auditable.
 *
 * Column 25 is `IsRootEvent`, not `EventCode` — the CAMEO block starts at 26,
 * and the ActionGeo block is led by `ActionGeo_Type` at 51 with the place name
 * at 52. Offsets verified against a live `.export.CSV` slice.
 */
export const GDELT_EVENT_COLUMNS = {
  globalEventId: 0,
  day: 1,
  isRootEvent: 25,
  eventCode: 26,
  eventBaseCode: 27,
  eventRootCode: 28,
  quadClass: 29,
  goldsteinScale: 30,
  numMentions: 31,
  numSources: 32,
  numArticles: 33,
  avgTone: 34,
  actionGeoType: 51,
  actionGeoFullName: 52,
  actionGeoCountryCode: 53,
  actionGeoLatitude: 56,
  actionGeoLongitude: 57,
  dateAdded: 59,
  sourceUrl: 60,
} as const;
