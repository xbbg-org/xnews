/**
 * OFAC (US Treasury Office of Foreign Assets Control) recent actions: new
 * sanctions designations, de-listings, and general licenses.
 *
 * OFAC publishes no API for this page. The listing is HTML, and every action
 * is addressed as `/recent-actions/<YYYYMMDD>`, which is also the only place
 * the action date appears in machine-readable form — the visible date text is
 * localized prose.
 */

export const OFAC_BASE_URL = "https://ofac.treasury.gov";
export const OFAC_RECENT_ACTIONS_URL = "https://ofac.treasury.gov/recent-actions";

/**
 * Matches a recent-action anchor and captures its path, the `YYYYMMDD`
 * segment, and the link text. Attribute order varies across OFAC's templates,
 * so the href is captured first and the remaining attributes are skipped
 * rather than anchored to a fixed shape.
 *
 * Compose a fresh `RegExp` from this per parse: a shared `/g/` instance
 * carries `lastIndex` between calls.
 */
export const OFAC_ACTION_LINK_PATTERN = String.raw`href="(/recent-actions/(\d{8})[^"]*)"[^>]*>([^<]+)<`;

/**
 * Converts OFAC's `YYYYMMDD` path segment to an ISO date. Returns `undefined`
 * for segments that are well-formed digits but not real dates (`20261340`),
 * so a template change cannot mint a nonsense publication date.
 */
export function ofacActionDate(segment: string): string | undefined {
  if (!/^\d{8}$/.test(segment)) return undefined;
  const isoDate = `${segment.slice(0, 4)}-${segment.slice(4, 6)}-${segment.slice(6, 8)}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === isoDate ? isoDate : undefined;
}
