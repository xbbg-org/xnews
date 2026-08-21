/**
 * GDACS current event list.
 *
 * The `MAP` variant this originally used now answers HTTP 400; `SEARCH` with
 * empty filters returns the same GeoJSON `FeatureCollection` and is what the
 * GDACS site itself calls.
 */
export const GDACS_EVENTS_URL =
  "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=&toDate=&alertlevel=";
