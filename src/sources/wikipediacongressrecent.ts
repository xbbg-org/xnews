import { filterEvents } from "../events.js";
import { fetchJsonText } from "../http.js";
import {
  isRecord,
  numberField,
  parseJsonRecord,
  recordArray,
  stringArrayField,
  stringField,
} from "../json.js";
import { normalizeDateWindow, normalizeLimit } from "../options.js";
import type { EventFetchOptions, EventRecord, EventSnapshot, EventSource } from "../types.js";
import {
  matchCongressionalIp,
  parseCongressionalIpRanges,
  type CongressChamber,
  type CongressionalIpRange,
} from "./wikipediacongressedits.js";
import { WIKIPEDIA_CONGRESS_EDITS_RANGES_URL } from "./wikipediacongressedits.urls.js";
import {
  WIKIPEDIA_CONGRESS_RECENT_DEFAULT_WINDOW_MS,
  WIKIPEDIA_RECENT_CHANGES_MAX_LIMIT,
  wikipediaCongressRecentChangesUrl,
  wikipediaRevisionDiffUrl,
} from "./wikipediacongressrecent.urls.js";

export {
  WIKIPEDIA_CONGRESS_RECENT_DEFAULT_WINDOW_MS,
  WIKIPEDIA_RECENT_CHANGES_API_URL,
  WIKIPEDIA_RECENT_CHANGES_MAX_LIMIT,
  wikipediaCongressRecentChangesUrl,
  wikipediaRevisionDiffUrl,
} from "./wikipediacongressrecent.urls.js";
export type { WikipediaCongressRecentChangesUrlOptions } from "./wikipediacongressrecent.urls.js";

const RECENT_CONGRESS_PROVIDER = "wikipedia-congress-edits" as const;
const RECENT_CONGRESS_DATASET = "recent-public-changes";
const RECENT_CONGRESS_SHAPE_ERROR = "unexpected Wikipedia recent-changes response shape";

export type WikipediaCongressEditorKind =
  | "public-ip"
  | "temporary-account"
  | "registered"
  | "anonymous";
export type WikipediaCongressRelevanceSignal =
  | "us-congress"
  | "us-house"
  | "us-senate"
  | "congressional-committee"
  | "federal-legislation";

export type WikipediaCongressAttribution =
  | {
      readonly kind: "congress-network";
      readonly chamber: CongressChamber;
      readonly congressionalNetwork: string;
      /** Present only when Wikimedia itself published the editor as an IP. */
      readonly contributorIp: string;
    }
  | { readonly kind: "unattributed" };

/**
 * One public recent change selected for either direct network attribution or
 * topical Congress relevance. `attribution` and `relevanceSignals` are
 * deliberately independent: an edit *about* Congress does not identify its
 * editor as congressional.
 */
export interface WikipediaCongressRecentChangeRow {
  readonly recentChangeId: number;
  readonly pageId: number;
  readonly revisionId: number;
  readonly oldRevisionId?: number;
  readonly changeType: "edit" | "new";
  readonly title: string;
  readonly diffUrl: string;
  readonly timestamp: string;
  readonly editor: string;
  readonly editorKind: WikipediaCongressEditorKind;
  readonly attribution: WikipediaCongressAttribution;
  readonly relevanceSignals: readonly WikipediaCongressRelevanceSignal[];
  readonly comment?: string;
  readonly minor: boolean;
  readonly sizeDelta?: number;
  readonly tags: readonly string[];
}

export interface WikipediaCongressRecentChangesOptions extends EventFetchOptions {
  /** Upstream RecentChanges page size before classification; defaults to 500. */
  readonly upstreamLimit?: number;
}

export interface WikipediaCongressRecentChangesPage {
  readonly rows: readonly WikipediaCongressRecentChangeRow[];
  readonly continueToken?: string;
}

/** Parses one Action API page and returns only classified rows. */
export function parseWikipediaCongressRecentChanges(
  body: string,
  ranges: readonly CongressionalIpRange[],
  options: WikipediaCongressRecentChangesOptions = {},
): WikipediaCongressRecentChangeRow[] {
  return [...parseWikipediaCongressRecentChangesPage(body, ranges, options).rows];
}

/**
 * Parses one page including its opaque continuation token. Direct attribution
 * requires all three facts: MediaWiki says `userid === 0`, the public editor
 * value is a valid IPv4 address, and that IP matches the Congress manifest.
 * An IP-shaped registered username therefore cannot spoof attribution.
 */
export function parseWikipediaCongressRecentChangesPage(
  body: string,
  ranges: readonly CongressionalIpRange[],
  options: WikipediaCongressRecentChangesOptions = {},
): WikipediaCongressRecentChangesPage {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return { rows: [] };
  if (ranges.length === 0) throw new Error(RECENT_CONGRESS_SHAPE_ERROR);

  const payload = parseJsonRecord(body, "Wikipedia recent changes");
  const query = payload["query"];
  const recentValues = isRecord(query) ? query["recentchanges"] : undefined;
  if (!Array.isArray(recentValues)) throw new Error(RECENT_CONGRESS_SHAPE_ERROR);
  const records = recordArray(recentValues);
  if (recentValues.length > 0 && records.length === 0) {
    throw new Error(RECENT_CONGRESS_SHAPE_ERROR);
  }

  const rows: WikipediaCongressRecentChangeRow[] = [];
  let recognizableRecords = 0;
  for (const record of records) {
    const recentChangeId = positiveInteger(record, "rcid");
    const pageId = positiveInteger(record, "pageid");
    const revisionId = positiveInteger(record, "revid");
    const oldRevisionId = positiveInteger(record, "old_revid");
    const userId = nonNegativeInteger(record, "userid");
    const title = stringField(record, "title")?.trim();
    const editor = stringField(record, "user")?.trim();
    const timestampText = stringField(record, "timestamp")?.trim();
    const changeType = stringField(record, "type")?.trim();
    if (
      recentChangeId === undefined ||
      pageId === undefined ||
      revisionId === undefined ||
      userId === undefined ||
      !title ||
      !editor ||
      !timestampText ||
      (changeType !== "edit" && changeType !== "new")
    ) {
      continue;
    }
    const timestampMs = Date.parse(timestampText);
    if (!Number.isFinite(timestampMs)) continue;
    recognizableRecords += 1;
    if (record["bot"] === true) continue;

    const temporary = record["temp"] === true || editor.startsWith("~");
    const publicIp = userId === 0 && isIpv4Address(editor);
    const ipMatch = publicIp ? matchCongressionalIp(editor, ranges) : undefined;
    const relevanceSignals = congressRelevanceSignals(
      `${title} ${stringField(record, "comment") ?? ""}`,
    );
    if (ipMatch === undefined && relevanceSignals.length === 0) continue;

    const oldLength = numberField(record, "oldlen");
    const newLength = numberField(record, "newlen");
    const sizeDelta =
      oldLength !== undefined && newLength !== undefined ? newLength - oldLength : undefined;
    const comment = stringField(record, "comment")?.trim();
    const attribution: WikipediaCongressAttribution =
      ipMatch === undefined
        ? { kind: "unattributed" }
        : {
            kind: "congress-network",
            chamber: ipMatch.range.chamber,
            congressionalNetwork: ipMatch.range.label,
            contributorIp: editor,
          };
    const editorKind: WikipediaCongressEditorKind = temporary
      ? "temporary-account"
      : publicIp
        ? "public-ip"
        : userId > 0
          ? "registered"
          : "anonymous";
    rows.push({
      recentChangeId,
      pageId,
      revisionId,
      ...(oldRevisionId === undefined ? {} : { oldRevisionId }),
      changeType,
      title,
      diffUrl: wikipediaRevisionDiffUrl(revisionId, oldRevisionId),
      timestamp: new Date(timestampMs).toISOString(),
      editor,
      editorKind,
      attribution,
      relevanceSignals,
      ...(comment ? { comment } : {}),
      minor: record["minor"] === true,
      ...(sizeDelta === undefined ? {} : { sizeDelta }),
      tags: stringArrayField(record, "tags"),
    });
    if (limit !== undefined && rows.length >= limit) break;
  }
  if (recentValues.length > 0 && recognizableRecords === 0) {
    throw new Error(RECENT_CONGRESS_SHAPE_ERROR);
  }

  const continueValue = payload["continue"];
  const continueToken = isRecord(continueValue)
    ? stringField(continueValue, "rccontinue")
    : undefined;
  return {
    rows,
    ...(continueToken === undefined ? {} : { continueToken }),
  };
}

/**
 * Reads every RecentChanges continuation page through the requested `since`
 * boundary. `upstreamLimit` is only page size; the public `limit` is applied
 * after Congress classification, so relevant edits cannot hide on page two.
 */
export async function fetchWikipediaCongressRecentChanges(
  options: WikipediaCongressRecentChangesOptions = {},
): Promise<WikipediaCongressRecentChangeRow[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const request = resolveRecentChangesRequest(options);
  const [firstBody, rangesBody] = await Promise.all([
    fetchJsonText(request.url, options),
    fetchJsonText(WIKIPEDIA_CONGRESS_EDITS_RANGES_URL, options),
  ]);
  const ranges = parseCongressionalIpRanges(rangesBody);
  const rows: WikipediaCongressRecentChangeRow[] = [];
  const seenTokens = new Set<string>();
  let body = firstBody;
  while (true) {
    const remaining = limit === undefined ? undefined : limit - rows.length;
    const page = parseWikipediaCongressRecentChangesPage(body, ranges, {
      ...options,
      ...(remaining === undefined ? {} : { limit: remaining }),
    });
    rows.push(...page.rows);
    if ((limit !== undefined && rows.length >= limit) || page.continueToken === undefined) break;
    if (seenTokens.has(page.continueToken)) {
      throw new Error("Wikipedia recent-changes continuation token repeated");
    }
    seenTokens.add(page.continueToken);
    body = await fetchJsonText(recentChangesPageUrl(request, page.continueToken), options);
  }
  return rows;
}

/**
 * Event-source view for alert generation. `createEventWatcher` deduplicates on
 * the stable revision id while typed callers can use the fetch function above
 * to inspect attribution and relevance separately.
 */
export function wikipediaCongressRecentChangesSource(
  options: WikipediaCongressRecentChangesOptions = {},
): EventSource<typeof RECENT_CONGRESS_PROVIDER> {
  const merged = (fetchOptions: EventFetchOptions): WikipediaCongressRecentChangesOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: RECENT_CONGRESS_PROVIDER,
    dataset: RECENT_CONGRESS_DATASET,
    requestUrls: (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      if (normalizeLimit(combined.limit) === 0) return [];
      return [resolveRecentChangesRequest(combined).url, WIKIPEDIA_CONGRESS_EDITS_RANGES_URL];
    },
    fetchSnapshot: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      if (normalizeLimit(combined.limit) === 0) return undefined;
      const rows = await fetchWikipediaCongressRecentChanges(combined);
      if (rows.length === 0) return undefined;
      const events = filterEvents<typeof RECENT_CONGRESS_PROVIDER>(
        rows.map(recentChangeEvent),
        combined,
      );
      if (events.length === 0) return undefined;
      return {
        provider: RECENT_CONGRESS_PROVIDER,
        dataset: RECENT_CONGRESS_DATASET,
        observedAt: new Date().toISOString(),
        events,
        warnings: [],
        requestUrls: [
          resolveRecentChangesRequest(combined).url,
          WIKIPEDIA_CONGRESS_EDITS_RANGES_URL,
        ],
      } satisfies EventSnapshot<typeof RECENT_CONGRESS_PROVIDER>;
    },
  };
}

function recentChangeEvent(
  row: WikipediaCongressRecentChangeRow,
): EventRecord<typeof RECENT_CONGRESS_PROVIDER> {
  const direct = row.attribution.kind === "congress-network";
  const summary = direct
    ? `Direct public-IP match: ${row.attribution.congressionalNetwork}. ${row.comment ?? ""}`.trim()
    : `Congress-relevant edit; editor origin is not attributed. Signals: ${row.relevanceSignals.join(", ")}. ${row.comment ?? ""}`.trim();
  return {
    id: `wikipedia-revision-${row.revisionId}`,
    provider: RECENT_CONGRESS_PROVIDER,
    category: "unknown",
    title: `Wikipedia ${row.changeType}: ${row.title}`,
    summary,
    url: row.diffUrl,
    observedAt: row.timestamp,
    severity: "unknown",
    ...(direct ? { areaName: row.attribution.congressionalNetwork } : {}),
    eventType: direct ? "direct-ip" : "congress-relevant",
  };
}

interface ResolvedRecentChangesRequest {
  readonly url: string;
  readonly since: string;
  readonly until: string;
  readonly upstreamLimit: number;
}

function resolveRecentChangesRequest(
  options: WikipediaCongressRecentChangesOptions,
  nowMs = Date.now(),
): ResolvedRecentChangesRequest {
  const window = normalizeDateWindow(options);
  const untilMs = window.untilMs ?? nowMs;
  const sinceMs = window.sinceMs ?? untilMs - WIKIPEDIA_CONGRESS_RECENT_DEFAULT_WINDOW_MS;
  const since = new Date(sinceMs).toISOString();
  const until = new Date(untilMs).toISOString();
  const upstreamLimit = options.upstreamLimit ?? WIKIPEDIA_RECENT_CHANGES_MAX_LIMIT;
  return {
    since,
    until,
    upstreamLimit,
    url: wikipediaCongressRecentChangesUrl({ since, until, limit: upstreamLimit }),
  };
}

function recentChangesPageUrl(
  request: ResolvedRecentChangesRequest,
  continueToken: string,
): string {
  return wikipediaCongressRecentChangesUrl({
    since: request.since,
    until: request.until,
    limit: request.upstreamLimit,
    continueToken,
  });
}

function positiveInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = numberField(record, key);
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = numberField(record, key);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const octet = Number(part);
      return Number.isInteger(octet) && octet >= 0 && octet <= 255;
    })
  );
}

function congressRelevanceSignals(text: string): WikipediaCongressRelevanceSignal[] {
  const signals: WikipediaCongressRelevanceSignal[] = [];
  if (/\b(?:united states|u\.?s\.?)\s+congress\b|\bcongressional\b/i.test(text)) {
    signals.push("us-congress");
  }
  if (/\b(?:united states|u\.?s\.?)\s+house of representatives\b/i.test(text)) {
    signals.push("us-house");
  }
  if (/\b(?:united states|u\.?s\.?)\s+senate\b/i.test(text)) signals.push("us-senate");
  if (/\b(?:house|senate|congressional)\s+committee\b/i.test(text)) {
    signals.push("congressional-committee");
  }
  if (/\b(?:H\.?R\.?|S\.)\s*\d+\b|\bPublic Law \d+-\d+\b/.test(text)) {
    signals.push("federal-legislation");
  }
  return signals;
}
