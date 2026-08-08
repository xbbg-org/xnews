/**
 * File retrieval for works-lane records.
 *
 * The catalog adapters answer with metadata; this module turns a `WorkRecord`
 * into actual bytes. Retrieval is two steps because none of these catalogs put
 * a file behind the record URL: `resolveWorkFiles` walks the provider's own
 * indirection to produce candidate file URLs, and `downloadFile` fetches one.
 * `downloadWork` does both and returns the first candidate that answers.
 *
 * Per provider:
 * - `libgen` — the mirror page at `/ads.php?md5=…` mints a single-use `key`
 *   for `/get.php`, so the page must be fetched first; the key is not derivable.
 * - `internet-archive` — `/metadata/<id>` lists every file; `/download/<id>/<name>`
 *   serves one. Restricted items answer 401.
 * - `annas-archive` — `/fast_download/<md5>/<path>/<domain>` needs a member key,
 *   which the caller supplies as `annasArchiveKey`; the JSON API at
 *   `/dyn/api/fast_download.json` is used when a key is present.
 * - `open-library` — a catalog, not a file host; resolves to nothing.
 *
 * Bytes are never decoded as text, so any file type passes through intact.
 */

import { XnewsFetchError } from "./errors.js";
import { BROWSERISH_USER_AGENT, fetchRaw, fetchText } from "./http.js";
import { elementPattern, decodeEntities } from "./text.js";
import type { SourceFetchOptions, WorkRecord } from "./types.js";

/** Books and scans routinely exceed the shared 32 MiB response ceiling. */
export const DEFAULT_DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** One retrievable file for a record. */
export interface WorkFile {
  readonly url: string;
  /** Provider's own label for the link, e.g. `"GET"`, `"EPUB"`, `"Fast Partner Server #1"`. */
  readonly label: string;
  readonly provider: string;
  readonly fileName?: string;
  /** Lowercase extension when the provider states one. */
  readonly format?: string;
  readonly sizeBytes?: number;
}

/** Downloaded bytes plus what the server said they are. */
export interface WorkDownload {
  readonly bytes: Uint8Array;
  /** URL that actually served the bytes. */
  readonly url: string;
  readonly fileName: string;
  readonly contentType?: string;
  readonly sizeBytes: number;
}

export interface DownloadOptions extends SourceFetchOptions {
  /**
   * Anna's Archive member key. Without it, Anna's Archive resolves to
   * candidate URLs that its server answers with 403 and a waitlist.
   */
  readonly annasArchiveKey?: string;
  /**
   * Mirror origins to resolve against, for md5-addressed catalogs. Each
   * mirror fronts its own CDN, so supplying the whole pool survives one CDN
   * going down. Falls back to `baseUrl`, then to the record's own origin.
   */
  readonly mirrors?: readonly string[];
  /** Single mirror origin; ignored when `mirrors` is set. */
  readonly baseUrl?: string;
}

/**
 * Candidate files for a record, best first. Returns an empty list for a
 * provider that hosts no files rather than throwing, so a mixed result set can
 * be walked uniformly.
 */
export async function resolveWorkFiles(
  record: WorkRecord,
  options: DownloadOptions = {},
): Promise<readonly WorkFile[]> {
  switch (record.provider) {
    case "libgen": {
      return resolveLibgenFiles(record, options);
    }
    case "internet-archive": {
      return resolveInternetArchiveFiles(record, options);
    }
    case "annas-archive": {
      return resolveAnnasArchiveFiles(record, options);
    }
    default: {
      return [];
    }
  }
}

/**
 * Fetches one URL and returns its bytes. Raises the response ceiling to
 * `DEFAULT_DOWNLOAD_MAX_BYTES` unless the caller set `maxResponseBytes`.
 */
export async function downloadFile(
  file: WorkFile | string,
  options: DownloadOptions = {},
): Promise<WorkDownload> {
  const url = typeof file === "string" ? file : file.url;
  const stated = typeof file === "string" ? undefined : file.fileName;
  const raw = await fetchRaw(url, downloadFetchOptions(options), {
    userAgent: options.userAgent ?? BROWSERISH_USER_AGENT,
  });
  const fileName =
    dispositionFileName(raw.contentDisposition) ?? stated ?? urlFileName(url) ?? "download";
  return {
    bytes: raw.bytes,
    url,
    fileName,
    ...(raw.contentType === undefined ? {} : { contentType: raw.contentType }),
    sizeBytes: raw.bytes.byteLength,
  };
}

/**
 * Resolves a record and downloads the first candidate that answers. Every
 * candidate's failure is kept, so an exhausted list names each attempt rather
 * than reporting only the last one.
 */
export async function downloadWork(
  record: WorkRecord,
  options: DownloadOptions = {},
): Promise<WorkDownload> {
  const files = await resolveWorkFiles(record, options);
  if (files.length === 0) {
    throw new XnewsFetchError(
      "config",
      `No downloadable file resolved for ${record.provider} record ${record.sourceId}`,
      { url: record.url },
    );
  }

  const failures: Error[] = [];
  for (const file of files) {
    try {
      return await downloadFile(file, options);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  const detail = files.map((file, index) => `${file.url} (${failures[index]?.message})`).join("; ");
  throw new XnewsFetchError("network", `All ${files.length} candidate file(s) failed: ${detail}`, {
    url: record.url,
  });
}

/**
 * Library Genesis mints a single-use `key` on the mirror page, so the file URL
 * cannot be built from the md5 alone.
 *
 * Every mirror fronts its own CDN and those go down independently — a live
 * probe found `cdn4.booksdl.lc` returning 503 while the catalog itself was
 * healthy. Passing `mirrors` therefore yields one candidate per mirror rather
 * than betting the download on whichever origin the record came from.
 */
async function resolveLibgenFiles(
  record: WorkRecord,
  options: DownloadOptions,
): Promise<readonly WorkFile[]> {
  const md5 = record.identity.md5;
  if (md5 === undefined) return [];
  const origins =
    options.mirrors !== undefined && options.mirrors.length > 0
      ? options.mirrors
      : [mirrorOrigin(options.baseUrl ?? record.url)];

  const files: WorkFile[] = [];
  const failures: string[] = [];
  for (const origin of origins) {
    let html: string;
    try {
      html = await fetchText(
        `${origin}/ads.php?md5=${encodeURIComponent(md5)}`,
        options,
        options.userAgent ?? BROWSERISH_USER_AGENT,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      failures.push(`${origin}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const match of html.matchAll(elementPattern("a"))) {
      const href = /href=["']([^"']+)["']/i.exec(match[1] ?? "")?.[1];
      if (href === undefined) continue;
      const decoded = decodeEntities(href);
      if (!LIBGEN_FILE_LINK.test(decoded)) continue;
      const url = absolute(decoded, origin);
      if (url === undefined || files.some((entry) => entry.url === url)) continue;
      files.push({
        url,
        label: stripTagText(match[2] ?? "") || "download",
        provider: record.provider,
        ...(record.format === undefined ? {} : { format: record.format }),
        ...(record.sizeBytes === undefined ? {} : { sizeBytes: record.sizeBytes }),
      });
    }
  }

  if (files.length === 0 && failures.length > 0) {
    throw new XnewsFetchError(
      "network",
      `No Library Genesis mirror served a download page: ${failures.join("; ")}`,
      { url: record.url },
    );
  }
  return files;
}

const LIBGEN_FILE_LINK =
  /get\.php\?|\/main\/|\.(?:epub|pdf|mobi|azw3?|djvu|fb2|cbr|cbz|txt|rtf|zip)(?:$|\?)/i;

/** Internet Archive publishes a complete file manifest per item. */
async function resolveInternetArchiveFiles(
  record: WorkRecord,
  options: DownloadOptions,
): Promise<readonly WorkFile[]> {
  const body = await fetchText(
    `https://archive.org/metadata/${encodeURIComponent(record.sourceId)}`,
    options,
    options.userAgent ?? BROWSERISH_USER_AGENT,
  );
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new XnewsFetchError(
      "config",
      `Internet Archive metadata for ${record.sourceId} was not JSON`,
      { url: record.url },
    );
  }
  if (typeof payload !== "object" || payload === null || !("files" in payload)) return [];
  const entries = payload.files;
  if (!Array.isArray(entries)) return [];

  const files: WorkFile[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    if (!("name" in entry) || typeof entry.name !== "string") continue;
    const name = entry.name;
    const extension = /\.([a-z\d]+)$/i.exec(name)?.[1]?.toLowerCase();
    if (extension === undefined || !DOWNLOADABLE.has(extension)) continue;
    const format = "format" in entry && typeof entry.format === "string" ? entry.format : undefined;
    const size = "size" in entry && typeof entry.size === "string" ? Number(entry.size) : undefined;
    files.push({
      url: `https://archive.org/download/${encodeURIComponent(record.sourceId)}/${encodeURIComponent(name)}`,
      label: format ?? extension.toUpperCase(),
      provider: record.provider,
      fileName: name,
      format: extension,
      ...(size === undefined || !Number.isFinite(size) ? {} : { sizeBytes: size }),
    });
  }
  return files.toSorted((left, right) => formatRank(left.format) - formatRank(right.format));
}

/**
 * Anna's Archive gates files behind membership. With a key, its documented
 * JSON API returns a direct URL; without one, the member endpoints are still
 * returned so a caller holding a session can use them.
 */
async function resolveAnnasArchiveFiles(
  record: WorkRecord,
  options: DownloadOptions,
): Promise<readonly WorkFile[]> {
  const md5 = record.identity.md5;
  if (md5 === undefined) return [];
  const origin = mirrorOrigin(options.baseUrl ?? record.url);

  if (options.annasArchiveKey !== undefined && options.annasArchiveKey !== "") {
    const url = new URL("/dyn/api/fast_download.json", origin);
    url.searchParams.set("md5", md5);
    url.searchParams.set("key", options.annasArchiveKey);
    const body = await fetchText(
      url.toString(),
      options,
      options.userAgent ?? BROWSERISH_USER_AGENT,
    );
    const parsed: unknown = JSON.parse(body);
    const direct =
      typeof parsed === "object" && parsed !== null && "download_url" in parsed
        ? parsed.download_url
        : undefined;
    if (typeof direct === "string" && direct !== "") {
      return [
        {
          url: direct,
          label: "fast_download",
          provider: record.provider,
          ...(record.format === undefined ? {} : { format: record.format }),
          ...(record.sizeBytes === undefined ? {} : { sizeBytes: record.sizeBytes }),
        },
      ];
    }
    const error =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String(parsed.error)
        : "no download_url";
    throw new XnewsFetchError("http_status", `Anna's Archive fast download refused: ${error}`, {
      url: url.toString(),
    });
  }

  // Partner-server indices; the server picks the mirror behind each one.
  return [0, 1, 2].map((domainIndex) => ({
    url: `${origin}/fast_download/${md5}/0/${domainIndex}`,
    label: `fast_download server ${domainIndex}`,
    provider: record.provider,
    ...(record.format === undefined ? {} : { format: record.format }),
    ...(record.sizeBytes === undefined ? {} : { sizeBytes: record.sizeBytes }),
  }));
}

const DOWNLOADABLE = new Set([
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "djvu",
  "fb2",
  "cbr",
  "cbz",
  "txt",
  "rtf",
  "doc",
  "docx",
  "odt",
  "zip",
  "chm",
  "lit",
]);

/** Reflowable first, then paged, then raw text; unknown formats sort last. */
const FORMAT_ORDER = ["epub", "azw3", "mobi", "pdf", "djvu", "cbz", "cbr", "odt", "doc", "txt"];

function formatRank(format: string | undefined): number {
  const index = format === undefined ? -1 : FORMAT_ORDER.indexOf(format);
  return index === -1 ? FORMAT_ORDER.length : index;
}

function downloadFetchOptions(options: DownloadOptions): SourceFetchOptions {
  return {
    ...options,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_DOWNLOAD_MAX_BYTES,
    // Catalogs mint a token on their own host and redirect to a CDN.
    allowCrossOriginRedirects: options.allowCrossOriginRedirects ?? true,
  };
}

/** Origin plus any path prefix, so a mirror served under a subpath still works. */
function mirrorOrigin(value: string): string {
  const url = new URL(value);
  const directory = url.pathname.replace(/\/[^/]*$/, "");
  return `${url.origin}${directory === "/" ? "" : directory}`;
}

function absolute(href: string, origin: string): string | undefined {
  try {
    const url = new URL(href, `${origin}/`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a filename from `Content-Disposition`, preferring the RFC 5987
 * `filename*` form, which is the only one that carries an encoding.
 */
export function dispositionFileName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(value)?.[1];
  if (extended !== undefined) {
    try {
      return sanitizeFileName(decodeURIComponent(extended.trim()));
    } catch {
      return sanitizeFileName(extended.trim());
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(value)?.[1];
  if (quoted !== undefined) return sanitizeFileName(quoted);
  const bare = /filename\s*=\s*([^;]+)/i.exec(value)?.[1];
  return bare === undefined ? undefined : sanitizeFileName(bare.trim());
}

function urlFileName(url: string): string | undefined {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name === "" ? undefined : sanitizeFileName(name);
  } catch {
    return undefined;
  }
}

/** Strips path separators and control characters so the name is safe to write. */
function sanitizeFileName(value: string): string {
  let flat = "";
  for (const character of value.replaceAll(/[/\\]+/g, "_")) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) flat += character;
  }
  return flat.trim().slice(0, 255);
}

function stripTagText(value: string): string {
  return decodeEntities(value.replaceAll(/<[^>]*>/g, " "))
    .replaceAll(/\s+/g, " ")
    .trim();
}
