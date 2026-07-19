import { fetchText, postJson } from "../http";
import { isRecord, recordArray, stringField } from "../json";
import { cleanText } from "../text";
import type { SourceFetchOptions } from "../types";

/** Options for transcript fetches. */
export interface YoutubeTranscriptOptions extends SourceFetchOptions {
  /**
   * Preferred caption languages in priority order (BCP-47 codes such as "en"
   * or "en-US"). Manual tracks win over auto-generated ones at equal
   * preference, and any available track is used as a last resort.
   * Defaults to ["en"].
   */
  readonly languages?: readonly string[];
}

/** One caption track advertised by a video's watch page. */
export interface YoutubeCaptionTrack {
  readonly url: string;
  readonly languageCode: string;
  readonly name?: string;
  /** True for auto-generated (speech recognition) tracks. */
  readonly generated: boolean;
}

export interface YoutubeTranscriptSegment {
  readonly text: string;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface YoutubeTranscript {
  readonly videoId: string;
  readonly languageCode: string;
  readonly trackName?: string;
  readonly generated: boolean;
  readonly segments: readonly YoutubeTranscriptSegment[];
  /** All segment texts joined with single spaces. */
  readonly text: string;
}

const BROWSERISH_USER_AGENT = "Mozilla/5.0 xnews/0.1.0";
const VIDEO_ID_PATTERN = /^[0-9A-Za-z_-]{11}$/;
const YOUTUBE_PLAYER_API_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
/**
 * The InnerTube ANDROID client's caption URLs are served without the browser
 * proof-of-origin token that gates web-client caption URLs (those return
 * empty 200 bodies). Version-pinned; the watch-page scrape is the fallback
 * for when YouTube stops accepting this client version.
 */
const ANDROID_CLIENT_VERSION = "20.10.38";
const ANDROID_USER_AGENT = `com.google.android.youtube/${ANDROID_CLIENT_VERSION} (Linux; U; Android 11) gzip`;

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * Extracts the 11-character video ID from a bare ID, a watch/shorts/embed/
 * live URL, or a youtu.be link. Returns undefined for anything else.
 */
export function extractYoutubeVideoId(video: string): string | undefined {
  const trimmed = video.trim();
  if (VIDEO_ID_PATTERN.test(trimmed)) return trimmed;

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  const isYoutubeHost =
    host === "youtube.com" || host === "youtube-nocookie.com" || host.endsWith(".youtube.com");
  if (!isYoutubeHost && host !== "youtu.be") return undefined;

  const fromQuery = parsed.searchParams.get("v");
  if (fromQuery && VIDEO_ID_PATTERN.test(fromQuery)) return fromQuery;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const candidate =
    host === "youtu.be"
      ? segments[0]
      : segments.length >= 2 && ["embed", "live", "shorts", "v"].includes(segments[0] ?? "")
        ? segments[1]
        : undefined;
  return candidate !== undefined && VIDEO_ID_PATTERN.test(candidate) ? candidate : undefined;
}

/**
 * Fetches a video's transcript through its advertised caption tracks: free
 * and keyless. Accepts a video ID or any YouTube video URL, for example the
 * `url` of an item returned by `fetchYoutubeSubscriptions`. Tracks come from
 * the InnerTube player API first (its caption URLs stay readable server-side)
 * with the watch-page player data as fallback. Throws when the video
 * advertises no caption tracks or the caption payload is gated.
 */
export async function fetchYoutubeTranscript(
  video: string,
  options: YoutubeTranscriptOptions = {},
): Promise<YoutubeTranscript> {
  const videoId = extractYoutubeVideoId(video);
  if (!videoId) throw new Error(`Could not extract a YouTube video ID from "${video}"`);

  const fetchOptions = options.userAgent
    ? options
    : { ...options, userAgent: BROWSERISH_USER_AGENT };

  let tracks: YoutubeCaptionTrack[] = [];
  let playerError: string | undefined;
  try {
    // The user agent must match the client context, so it is not overridable.
    const playerBody = await postJson(
      YOUTUBE_PLAYER_API_URL,
      {
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: ANDROID_CLIENT_VERSION,
            androidSdkVersion: 30,
            hl: "en",
          },
        },
        videoId,
      },
      { ...options, userAgent: ANDROID_USER_AGENT },
    );
    tracks = parseYoutubeCaptionTracks(playerBody);
  } catch (error) {
    playerError = error instanceof Error ? error.message : String(error);
  }
  if (tracks.length === 0) {
    tracks = parseYoutubeCaptionTracks(await fetchText(youtubeWatchUrl(videoId), fetchOptions));
  }

  const track = pickYoutubeCaptionTrack(tracks, options.languages ?? ["en"]);
  if (!track) {
    const playerNote = playerError ? ` (player API: ${playerError})` : "";
    throw new Error(
      `No caption tracks found for YouTube video ${videoId}${playerNote} (captions may be disabled, or YouTube served no player data)`,
    );
  }

  const captionBody = await fetchText(track.url, fetchOptions);
  const segments = parseYoutubeTranscriptSegments(captionBody);
  if (segments.length === 0 && captionBody.trim().length === 0) {
    throw new Error(
      `Empty caption payload for YouTube video ${videoId} (the "${track.languageCode}" caption URL likely requires a browser proof-of-origin token)`,
    );
  }
  return {
    videoId,
    languageCode: track.languageCode,
    ...(track.name ? { trackName: track.name } : {}),
    generated: track.generated,
    segments,
    text: segments.map((segment) => segment.text).join(" "),
  };
}

/** Reads the caption track list out of watch-page HTML or player-response JSON. */
export function parseYoutubeCaptionTracks(body: string): YoutubeCaptionTrack[] {
  const marker = body.match(/"captionTracks"\s*:\s*\[/);
  if (marker?.index === undefined) return [];
  const arrayText = extractBalancedArray(body, marker.index + marker[0].length - 1);
  if (!arrayText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return [];
  }

  const tracks: YoutubeCaptionTrack[] = [];
  for (const track of recordArray(parsed)) {
    const url = stringField(track, "baseUrl");
    const languageCode = stringField(track, "languageCode");
    if (!url || !languageCode) continue;
    const name = trackName(track);
    tracks.push({
      url,
      languageCode,
      ...(name ? { name } : {}),
      generated: stringField(track, "kind") === "asr",
    });
  }
  return tracks;
}

/**
 * Picks the best caption track for a language preference list: exact code
 * match first, then same base language (e.g. "en" matches "en-US"), with
 * manual tracks preferred over auto-generated ones, then any track at all.
 */
export function pickYoutubeCaptionTrack(
  tracks: readonly YoutubeCaptionTrack[],
  languages: readonly string[] = ["en"],
): YoutubeCaptionTrack | undefined {
  if (tracks.length === 0) return undefined;
  for (const wanted of languages) {
    const code = wanted.trim().toLowerCase();
    if (!code) continue;

    const exact = bestTrack(tracks, (track) => track.languageCode.toLowerCase() === code);
    if (exact) return exact;

    const separator = code.indexOf("-");
    const base = separator === -1 ? code : code.slice(0, separator);
    const related = bestTrack(tracks, (track) => {
      const trackCode = track.languageCode.toLowerCase();
      return trackCode === base || trackCode.startsWith(`${base}-`);
    });
    if (related) return related;
  }
  return bestTrack(tracks, () => true);
}

/** Parses a timedtext XML body (`<text start dur>` elements) into ordered segments. */
export function parseYoutubeTranscriptSegments(xml: string): YoutubeTranscriptSegment[] {
  const segments: YoutubeTranscriptSegment[] = [];
  // srv1: <text start="1.2" dur="3.4">…</text> with timings in seconds.
  for (const match of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const text = cleanText(match[2] ?? "");
    if (!text) continue;
    const attrs = match[1] ?? "";
    segments.push({
      text,
      startMs: readSecondsAttr(attrs, "start"),
      durationMs: readSecondsAttr(attrs, "dur"),
    });
  }
  if (segments.length > 0) return segments;

  // srv3: <p t="80" d="2360"> paragraphs in milliseconds, holding plain text
  // or <s> word fragments that concatenate without separators.
  for (const match of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const text = cleanText((match[2] ?? "").replace(/<[^>]*>/g, ""));
    if (!text) continue;
    const attrs = match[1] ?? "";
    segments.push({
      text,
      startMs: readMillisAttr(attrs, "t"),
      durationMs: readMillisAttr(attrs, "d"),
    });
  }
  return segments;
}

function bestTrack(
  tracks: readonly YoutubeCaptionTrack[],
  matches: (track: YoutubeCaptionTrack) => boolean,
): YoutubeCaptionTrack | undefined {
  let fallback: YoutubeCaptionTrack | undefined;
  for (const track of tracks) {
    if (!matches(track)) continue;
    if (!track.generated) return track;
    fallback ??= track;
  }
  return fallback;
}

function trackName(track: Record<string, unknown>): string | undefined {
  const name = track["name"];
  if (!isRecord(name)) return undefined;
  const simple = stringField(name, "simpleText");
  if (simple) return simple;
  const text = recordArray(name["runs"])
    .map((run) => stringField(run, "text") ?? "")
    .join("");
  return text || undefined;
}

/** Returns the balanced `[…]` slice starting at `startIndex`, string-aware. */
function extractBalancedArray(source: string, startIndex: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (code === 0x5c /* \ */) escaped = true;
      else if (code === 0x22 /* " */) inString = false;
      continue;
    }
    if (code === 0x22 /* " */) inString = true;
    else if (code === 0x5b /* [ */) depth += 1;
    else if (code === 0x5d /* ] */) {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }
  return undefined;
}

function readSecondsAttr(attrs: string, name: string): number {
  const value = attrs.match(new RegExp(`\\b${name}=["']([\\d.]+)["']`))?.[1];
  const seconds = value === undefined ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

function readMillisAttr(attrs: string, name: string): number {
  const value = attrs.match(new RegExp(`\\b${name}=["'](\\d+)["']`))?.[1];
  const millis = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(millis) ? millis : 0;
}
