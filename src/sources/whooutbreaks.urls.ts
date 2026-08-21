/**
 * WHO Disease Outbreak News: the World Health Organization's authoritative
 * notices of verified outbreak events.
 *
 * The endpoint is the JSON backing WHO's own news pages. It is unversioned and
 * undocumented, but stable and keyless.
 */

export const WHO_BASE_URL = "https://www.who.int";
export const WHO_DISEASE_OUTBREAK_NEWS_URL = "https://www.who.int/api/news/diseaseoutbreaknews";

/**
 * WHO returns item paths relative to the site root (`/emergencies/...`).
 * Absolute URLs occasionally appear for syndicated items, so pass those
 * through untouched instead of double-prefixing them.
 */
export function whoOutbreakUrl(itemDefaultUrl: string): string | undefined {
  const path = itemDefaultUrl.trim();
  if (path === "") return undefined;
  try {
    return new URL(path, WHO_BASE_URL).toString();
  } catch {
    return undefined;
  }
}
