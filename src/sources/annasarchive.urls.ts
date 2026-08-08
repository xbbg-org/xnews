/**
 * URL builders for a caller-supplied Anna's Archive mirror.
 *
 * Anna's Archive hostnames rotate, so every builder requires a `baseUrl` and
 * validates it as an HTTPS origin before producing a URL.
 */

import { XnewsFetchError } from "../errors.js";

export const ANNAS_ARCHIVE_SEARCH_PATH = "/search";
export const ANNAS_ARCHIVE_MD5_PATH = "/md5/";
export const ANNAS_ARCHIVE_DEFAULT_PER_PAGE = 50;

export interface AnnasArchiveMirrorOptions {
  /** Absolute HTTPS origin of the mirror to query. Required: there is no default. */
  readonly baseUrl: string;
}

export interface AnnasArchiveSearchUrlOptions extends AnnasArchiveMirrorOptions {
  /** 1-based result page; defaults to 1. */
  readonly page?: number;
}

/** Builds one server-rendered search-result URL against the supplied mirror. */
export function annasArchiveSearchUrl(
  query: string,
  options: AnnasArchiveSearchUrlOptions,
): string {
  const trimmed = query.trim();
  if (trimmed === "") {
    throw new XnewsFetchError(
      "config",
      "Anna's Archive needs a non-empty query; set query, title, author, isbn, or doi",
      { url: options.baseUrl ?? "" },
    );
  }

  const page = normalizePage(options.page, options.baseUrl);
  const url = mirrorUrl(options.baseUrl, ANNAS_ARCHIVE_SEARCH_PATH);
  url.searchParams.set("q", trimmed);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

/** Builds the canonical human-facing record URL for one MD5-addressed file. */
export function annasArchiveRecordUrl(md5: string, options: AnnasArchiveMirrorOptions): string {
  const normalized = md5.trim().toLowerCase();
  if (!/^[a-f\d]{32}$/.test(normalized)) {
    throw new XnewsFetchError("config", `Invalid Anna's Archive md5: ${md5}`, {
      url: options.baseUrl ?? "",
    });
  }
  return mirrorUrl(options.baseUrl, `${ANNAS_ARCHIVE_MD5_PATH}${normalized}`).toString();
}

/** Normalized caller-supplied mirror base, for provenance and parse errors. */
export function annasArchiveMirrorBase(baseUrl: string): string {
  return mirrorBase(baseUrl).toString();
}

function mirrorUrl(baseUrl: string, path: string): URL {
  const base = mirrorBase(baseUrl);
  return new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base);
}

function mirrorBase(baseUrl: string): URL {
  const trimmed = baseUrl?.trim() ?? "";
  if (trimmed === "") {
    throw new XnewsFetchError("config", "Anna's Archive requires a mirror baseUrl", { url: "" });
  }

  let url: URL;
  try {
    url = new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
  } catch {
    throw new XnewsFetchError("config", `Invalid Anna's Archive baseUrl: ${trimmed}`, {
      url: trimmed,
    });
  }
  if (url.protocol !== "https:") {
    throw new XnewsFetchError(
      "config",
      `Anna's Archive baseUrl must be HTTPS; received ${url.protocol}`,
      { url: trimmed },
    );
  }
  if (url.username || url.password) {
    throw new XnewsFetchError("config", "Anna's Archive baseUrl must not contain credentials", {
      url: trimmed,
    });
  }
  url.search = "";
  url.hash = "";
  return url;
}

function normalizePage(page: number | undefined, baseUrl: string): number {
  if (page === undefined) return 1;
  if (!Number.isInteger(page) || page < 1) {
    throw new XnewsFetchError("config", `page must be a positive integer; received ${page}`, {
      url: baseUrl ?? "",
    });
  }
  return page;
}
