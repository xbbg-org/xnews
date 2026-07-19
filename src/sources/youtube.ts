import { fetchText } from "../http";
import { normalizeDateWindow, normalizeLimit, type DateWindow } from "../options";
import { cleanText, decodeEntities, stableId } from "../text";
import type { NewsItem, SourceFetchOptions } from "../types";

/** Options for YouTube channel-feed fetches. */
export interface YoutubeFeedOptions extends SourceFetchOptions {
  /**
   * Fetch the channel's long-form uploads playlist instead of the full
   * channel feed, excluding Shorts at the feed level. Defaults to false.
   */
  readonly hideShorts?: boolean;
}

/** Per-channel outcome of a subscription fetch. */
export interface YoutubeChannelResult {
  /** The channel exactly as requested (ID, URL, or handle). */
  readonly channel: string;
  /** The resolved `UC…` channel ID, when resolution succeeded. */
  readonly channelId?: string;
  readonly items: readonly NewsItem[];
  readonly error?: string;
}

/** Merged subscription feed plus per-channel outcomes. */
export interface YoutubeSubscriptionsResult {
  /** All channels' videos merged and deduplicated, newest first. */
  readonly items: readonly NewsItem[];
  readonly channels: readonly YoutubeChannelResult[];
  /** True when at least one channel failed to resolve or fetch. */
  readonly partial: boolean;
}

const YOUTUBE_FEED_BASE = "https://www.youtube.com/feeds/videos.xml";
const BROWSERISH_USER_AGENT = "Mozilla/5.0 xnews/0.1.0";
const CHANNEL_ID_PATTERN = /^UC[0-9A-Za-z_-]{16,}$/;
const CHANNEL_URL_ID_PATTERN = /youtube\.com\/channel\/(UC[0-9A-Za-z_-]{16,})/i;
const PAGE_CHANNEL_ID_PATTERN =
  /"(?:channelId|externalId|browseId)"\s*:\s*"(UC[0-9A-Za-z_-]{16,})"/;

export function isYoutubeChannelId(value: string): boolean {
  return CHANNEL_ID_PATTERN.test(value);
}

/**
 * YouTube's public per-channel Atom feed: free and keyless, returns the ~15
 * most recent uploads. With `hideShorts` the `UC…` channel ID is swapped for
 * the channel's `UULF…` long-form uploads playlist, which excludes Shorts.
 * The endpoint intermittently returns 404 for every channel during certain
 * hours; that is an upstream outage, not a bad channel ID.
 */
export function youtubeChannelFeedUrl(
  channelId: string,
  options: { hideShorts?: boolean } = {},
): string {
  if (options.hideShorts && channelId.startsWith("UC")) {
    return `${YOUTUBE_FEED_BASE}?playlist_id=${encodeURIComponent(`UULF${channelId.slice(2)}`)}`;
  }
  return `${YOUTUBE_FEED_BASE}?channel_id=${encodeURIComponent(channelId)}`;
}

/**
 * Resolves a channel reference — a `UC…` ID, a channel/handle URL, or a bare
 * `@handle` — to the canonical `UC…` channel ID. IDs and `/channel/UC…` URLs
 * resolve locally; anything else fetches the channel page once and reads the
 * canonical channel link out of the HTML.
 */
export async function resolveYoutubeChannelId(
  channel: string,
  options: SourceFetchOptions = {},
): Promise<string> {
  const trimmed = channel.trim();
  if (!trimmed) throw new Error("YouTube channel is required");
  if (isYoutubeChannelId(trimmed)) return trimmed;

  const fromUrl = trimmed.match(CHANNEL_URL_ID_PATTERN)?.[1];
  if (fromUrl) return fromUrl;

  const pageUrl = youtubeChannelPageUrl(trimmed);
  const html = await fetchText(
    pageUrl,
    options.userAgent ? options : { ...options, userAgent: BROWSERISH_USER_AGENT },
  );
  const resolved =
    html.match(CHANNEL_URL_ID_PATTERN)?.[1] ?? html.match(PAGE_CHANNEL_ID_PATTERN)?.[1];
  if (!resolved) {
    throw new Error(`Could not find a channel ID on ${pageUrl}`);
  }
  return resolved;
}

/** Fetches one channel's recent uploads. Accepts an ID, URL, or handle. */
export async function fetchYoutubeChannelVideos(
  channel: string,
  options: YoutubeFeedOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const items = await fetchChannelItems(channel, options, normalizeDateWindow(options));
  return limit === undefined ? items : items.slice(0, limit);
}

/**
 * Fetches every subscribed channel's feed concurrently and merges the videos
 * into one feed, newest first. A channel that fails to resolve or fetch is
 * reported on its per-channel result instead of failing the whole batch.
 * `limit` caps the merged feed, not each channel; each channel feed carries
 * at most ~15 entries upstream.
 */
export async function fetchYoutubeSubscriptions(
  channels: readonly string[],
  options: YoutubeFeedOptions = {},
): Promise<YoutubeSubscriptionsResult> {
  const limit = normalizeLimit(options.limit);
  const window = normalizeDateWindow(options);
  const results = await Promise.all(
    channels.map((channel) => fetchChannelResult(channel, options, window)),
  );

  const byId = new Map<string, NewsItem>();
  for (const result of results) {
    for (const item of result.items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  const merged = [...byId.values()].toSorted(compareByPublishedDesc);

  return {
    items: limit === undefined ? merged : merged.slice(0, limit),
    channels: results,
    partial: results.some((result) => result.error !== undefined),
  };
}

/** Parses a channel or playlist Atom feed into news items. */
export function parseYoutubeChannelVideos(xml: string, limit?: number): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const items: NewsItem[] = [];
  for (const block of matchEntryBlocks(xml)) {
    const title = cleanText(readTag(block, "title"));
    const videoId = cleanText(readTag(block, "videoId"));
    const link =
      readAlternateLink(block) || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    if (!title || !link) continue;

    const url = decodeEntities(link);
    const channelName = cleanText(readTag(block, "name"));
    const published =
      cleanText(readTag(block, "published")) || cleanText(readTag(block, "updated"));
    const publishedAt = toIsoDate(published);
    const summary = cleanText(readTag(block, "description"));

    items.push({
      id: stableId(["youtube", videoId || url, title]),
      provider: "youtube",
      kind: "video",
      title,
      url,
      canonicalUrl: url,
      source: channelName || "YouTube",
      ...(publishedAt ? { publishedAt } : {}),
      ...(published ? { publishedAtText: published } : {}),
      ...(summary ? { summary } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  return items;
}

async function fetchChannelResult(
  channel: string,
  options: YoutubeFeedOptions,
  window: DateWindow,
): Promise<YoutubeChannelResult> {
  let channelId: string | undefined;
  try {
    channelId = await resolveYoutubeChannelId(channel, options);
    const items = await fetchChannelItems(channelId, options, window);
    return { channel, channelId, items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      channel,
      ...(channelId === undefined ? {} : { channelId }),
      items: [],
      error: /\b404\b/.test(message)
        ? `${message} (YouTube's feed endpoint intermittently 404s for all channels; retry later before suspecting the channel ID)`
        : message,
    };
  }
}

async function fetchChannelItems(
  channel: string,
  options: YoutubeFeedOptions,
  window: DateWindow,
): Promise<NewsItem[]> {
  const channelId = await resolveYoutubeChannelId(channel, options);
  const feedUrl = youtubeChannelFeedUrl(channelId, options);
  const xml = await fetchText(
    feedUrl,
    options.userAgent ? options : { ...options, userAgent: BROWSERISH_USER_AGENT },
  );
  return filterByDateWindow(parseYoutubeChannelVideos(xml), window);
}

function youtubeChannelPageUrl(channel: string): string {
  if (/^https?:\/\//i.test(channel)) return channel;
  const handle = channel.startsWith("@") ? channel : `@${channel}`;
  return `https://www.youtube.com/${handle}`;
}

function filterByDateWindow(items: readonly NewsItem[], window: DateWindow): NewsItem[] {
  if (window.sinceMs === undefined && window.untilMs === undefined) return [...items];
  return items.filter((item) => {
    if (!item.publishedAt) return false;
    const publishedAtMs = Date.parse(item.publishedAt);
    if (!Number.isFinite(publishedAtMs)) return false;
    if (window.sinceMs !== undefined && publishedAtMs < window.sinceMs) return false;
    return window.untilMs === undefined || publishedAtMs <= window.untilMs;
  });
}

function compareByPublishedDesc(left: NewsItem, right: NewsItem): number {
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
  if (rightTime !== leftTime) return rightTime - leftTime;
  return right.id.localeCompare(left.id);
}

function* matchEntryBlocks(xml: string): Generator<string> {
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1];
    if (block !== undefined) yield block;
  }
}

function readTag(block: string, tag: string): string {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`,
    "i",
  );
  return block.match(pattern)?.[1] ?? "";
}

function readAlternateLink(block: string): string {
  const alternate = block.match(
    /<link\b(?=[^>]*rel=["']alternate["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>/i,
  )?.[1];
  return alternate ?? block.match(/<link\b(?=[^>]*href=["']([^"']+)["'])[^>]*>/i)?.[1] ?? "";
}

function toIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
