import { hasAsciiControlCharacters } from "../text.js";
import type { SourceFetchOptions } from "../types.js";

/** Options for YouTube channel-feed fetches. */
export interface YoutubeFeedOptions extends SourceFetchOptions {
  /**
   * Fetch the channel's long-form uploads playlist instead of the full
   * channel feed, excluding Shorts at the feed level. Defaults to false.
   */
  readonly hideShorts?: boolean;
}

const YOUTUBE_FEED_BASE = "https://www.youtube.com/feeds/videos.xml";

/**
 * YouTube's public per-channel Atom feed: free and keyless, returns the ~15
 * most recent uploads. With `hideShorts` the `UC…` channel ID is swapped for
 * the channel's `UULF…` long-form uploads playlist, which excludes Shorts.
 * The endpoint intermittently returns 404 for every channel during certain
 * hours; that is an upstream outage, not a bad channel ID.
 */
export function youtubeChannelFeedUrl(
  channelId: string,
  options: Pick<YoutubeFeedOptions, "hideShorts"> = {},
): string {
  if (options.hideShorts && channelId.startsWith("UC")) {
    return `${YOUTUBE_FEED_BASE}?playlist_id=${encodeURIComponent(`UULF${channelId.slice(2)}`)}`;
  }
  return `${YOUTUBE_FEED_BASE}?channel_id=${encodeURIComponent(channelId)}`;
}

export function youtubeChannelPageUrl(channel: string): string {
  const value = channel.trim();
  if (!value) throw new TypeError("YouTube channel is required");

  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError("YouTube channel URL is invalid");
    }
    const host = url.hostname.toLowerCase();
    const youtubeHost = host === "youtube.com" || host.endsWith(".youtube.com");
    if (
      url.protocol !== "https:" ||
      !youtubeHost ||
      host.endsWith(".") ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      throw new TypeError("YouTube channel URL must be an HTTPS youtube.com URL");
    }
    if (
      !/^\/(?:@[^/]+|channel\/UC[\w-]{16,}|c\/[^/]+|user\/[^/]+)(?:\/(?:videos|featured|streams|shorts|playlists|community))?\/?$/.test(
        url.pathname,
      )
    ) {
      throw new TypeError("YouTube channel URL has an unsupported path");
    }
    return `${url.origin}${url.pathname}`;
  }

  const handle = value.startsWith("@") ? value.slice(1) : value;
  if (!handle || /[/?#\\]/.test(handle) || hasAsciiControlCharacters(handle)) {
    throw new TypeError("YouTube handle is invalid");
  }
  return `https://www.youtube.com/@${encodeURIComponent(handle)}`;
}
