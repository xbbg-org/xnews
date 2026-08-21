/** Official English-Wikipedia Action API used for public recent changes. */
export const WIKIPEDIA_RECENT_CHANGES_API_URL = "https://en.wikipedia.org/w/api.php";
export const WIKIPEDIA_CONGRESS_RECENT_DEFAULT_WINDOW_MS = 60 * 60_000;
export const WIKIPEDIA_RECENT_CHANGES_MAX_LIMIT = 500;

export interface WikipediaCongressRecentChangesUrlOptions {
  /** Inclusive newer boundary as an ISO instant. Defaults to now. */
  readonly until: string;
  /** Inclusive older boundary as an ISO instant. Defaults to one hour before `until`. */
  readonly since: string;
  /** Upstream page size, 1–500. This is before Congress classification. */
  readonly limit?: number;
  /** Opaque Action API continuation token from the previous response. */
  readonly continueToken?: string;
}

/**
 * Builds a newest-first RecentChanges query over edits and new pages. Bots are
 * excluded upstream; registered, temporary-account, and still-public IP edits
 * remain so attribution and topical relevance stay separate.
 */
export function wikipediaCongressRecentChangesUrl(
  options: WikipediaCongressRecentChangesUrlOptions,
): string {
  const sinceMs = requireIsoInstant(options.since, "since");
  const untilMs = requireIsoInstant(options.until, "until");
  if (sinceMs > untilMs)
    throw new RangeError("Wikipedia recent-changes since must not exceed until");
  const limit = options.limit ?? WIKIPEDIA_RECENT_CHANGES_MAX_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WIKIPEDIA_RECENT_CHANGES_MAX_LIMIT) {
    throw new RangeError(
      `Wikipedia recent-changes limit must be an integer from 1 to ${WIKIPEDIA_RECENT_CHANGES_MAX_LIMIT}`,
    );
  }

  const url = new URL(WIKIPEDIA_RECENT_CHANGES_API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("list", "recentchanges");
  url.searchParams.set("rctype", "edit|new");
  url.searchParams.set("rcshow", "!bot");
  url.searchParams.set("rcprop", "title|ids|timestamp|user|userid|comment|flags|sizes|tags");
  url.searchParams.set("rcdir", "older");
  url.searchParams.set("rcstart", new Date(untilMs).toISOString());
  url.searchParams.set("rcend", new Date(sinceMs).toISOString());
  if (options.continueToken !== undefined) {
    url.searchParams.set("continue", "-||");
    url.searchParams.set("rccontinue", options.continueToken);
  }
  url.searchParams.set("rclimit", String(limit));
  return url.toString();
}

export function wikipediaRevisionDiffUrl(revisionId: number, oldRevisionId?: number): string {
  if (!Number.isSafeInteger(revisionId) || revisionId < 1) {
    throw new RangeError("Wikipedia revisionId must be a positive safe integer");
  }
  const url = new URL("https://en.wikipedia.org/w/index.php");
  url.searchParams.set("diff", String(revisionId));
  if (oldRevisionId !== undefined && Number.isSafeInteger(oldRevisionId) && oldRevisionId > 0) {
    url.searchParams.set("oldid", String(oldRevisionId));
  }
  return url.toString();
}

function requireIsoInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new RangeError(`Wikipedia recent-changes ${label} is invalid`);
  return parsed;
}
