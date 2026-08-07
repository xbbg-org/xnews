import { hasAsciiControlCharacters, stripAsciiControlCharacters } from "./text.js";
import type { ProviderErrorCode, SourceFetchOptions } from "./types.js";

const DEFAULT_USER_AGENT = "xnews (+https://github.com/xbbg-org/xnews)";

/**
 * Some providers serve bot-shaped User-Agents an interstitial or a 403; they
 * get a browser-shaped string instead. Deliberately versionless: embedded
 * package versions drift the moment a release bumps the manifest.
 */
export const BROWSERISH_USER_AGENT = "Mozilla/5.0 (compatible; xnews)";

/**
 * Every transport failure from `fetchText`/`postJson` is an `XnewsFetchError`
 * with a machine-readable `code`, so consumers classify failures without
 * parsing message text. `config` failures are policy preconditions (a missing
 * SEC User-Agent, EMMA terms not accepted, no fetch implementation) and are
 * raised before any network I/O.
 */
export class XnewsFetchError extends Error {
  readonly code: ProviderErrorCode;
  readonly url: string;
  readonly status?: number;

  constructor(
    code: ProviderErrorCode,
    message: string,
    details: { readonly url: string; readonly status?: number },
  ) {
    super(message);
    this.name = "XnewsFetchError";
    this.code = code;
    this.url = redactUrl(details.url);
    if (details.status !== undefined) this.status = details.status;
  }
}

export async function fetchText(
  url: string,
  options: SourceFetchOptions = {},
  requestUserAgent = options.userAgent ?? DEFAULT_USER_AGENT,
): Promise<string> {
  return requestText(url, options, requestUserAgent);
}

/**
 * POSTs a JSON body and returns the response text, with `fetchText`'s
 * timeout, abort, redirect, and error semantics.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: SourceFetchOptions = {},
  requestUserAgent = options.userAgent ?? DEFAULT_USER_AGENT,
): Promise<string> {
  return requestText(url, options, requestUserAgent, JSON.stringify(body));
}

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_QUERY_KEY =
  /(?:^|[_-])(?:api[_-]?key|auth|credential|password|secret|sig(?:nature)?|token)(?:$|[_-])/i;

async function requestText(
  url: string,
  options: SourceFetchOptions,
  requestUserAgent: string,
  jsonBody?: string,
): Promise<string> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new XnewsFetchError("config", "No fetch implementation is available in this runtime", {
      url,
    });
  }

  let currentUrl = url;
  let method = jsonBody === undefined ? "GET" : "POST";
  let requestBody = jsonBody;
  if (options.signal?.aborted) {
    const displayUrl = redactUrl(currentUrl);
    throw new XnewsFetchError("aborted", `${method} ${displayUrl} aborted before request`, {
      url: currentUrl,
    });
  }

  const redirectMode = options.redirect ?? "follow";
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const upstreamAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", upstreamAbort, { once: true });

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      // Rebuild host-scoped policy headers before every hop. The injected
      // transport receives `manual`, so it cannot follow a destination before
      // SEC identity and EMMA consent are checked for that destination.
      const headers = makeHeaders(currentUrl, options, requestBody !== undefined, requestUserAgent);
      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
          headers,
          ...(requestBody === undefined ? {} : { method, body: requestBody }),
        });
      } catch {
        const displayUrl = redactUrl(currentUrl);
        throw new XnewsFetchError(
          "network",
          `${method} ${displayUrl} failed: network request failed`,
          { url: currentUrl },
        );
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectMode !== "follow") {
          const displayUrl = redactUrl(currentUrl);
          if (redirectMode === "error") {
            throw new XnewsFetchError(
              "network",
              `${method} ${displayUrl} failed: redirects are disabled`,
              { url: currentUrl },
            );
          }
          throw httpStatusError(method, currentUrl, response);
        }

        const location = response.headers.get("location");
        if (!location) throw httpStatusError(method, currentUrl, response);
        if (redirectCount >= MAX_REDIRECTS) {
          const displayUrl = redactUrl(currentUrl);
          throw new XnewsFetchError(
            "network",
            `${method} ${displayUrl} failed: more than ${MAX_REDIRECTS} redirects`,
            { url: currentUrl },
          );
        }

        try {
          currentUrl = new URL(location, currentUrl).href;
        } catch {
          const displayUrl = redactUrl(currentUrl);
          throw new XnewsFetchError(
            "network",
            `${method} ${displayUrl} failed: invalid redirect location`,
            { url: currentUrl },
          );
        }
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) && method === "POST")
        ) {
          method = "GET";
          requestBody = undefined;
        }
        continue;
      }

      if (!response.ok) throw httpStatusError(method, currentUrl, response);
      return await response.text();
    }
  } catch (error) {
    const displayUrl = redactUrl(currentUrl);
    if (timedOut) {
      throw new XnewsFetchError(
        "timeout",
        `${method} ${displayUrl} timed out after ${timeoutMs}ms`,
        { url: currentUrl },
      );
    }
    if (options.signal?.aborted) {
      throw new XnewsFetchError("aborted", `${method} ${displayUrl} aborted`, {
        url: currentUrl,
      });
    }
    if (error instanceof XnewsFetchError) throw error;
    throw new XnewsFetchError("network", `${method} ${displayUrl} failed: network request failed`, {
      url: currentUrl,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", upstreamAbort);
  }
}

function httpStatusError(method: string, url: string, response: Response): XnewsFetchError {
  const displayUrl = redactUrl(url);
  return new XnewsFetchError(
    "http_status",
    `${method} ${displayUrl} failed: HTTP ${response.status}`,
    { url, status: response.status },
  );
}

function makeHeaders(
  url: string,
  options: SourceFetchOptions,
  json: boolean,
  requestUserAgent: string,
): Record<string, string> {
  const parsedUrl = parseRequestUrl(url);
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.5",
    "User-Agent": requestUserAgent,
  };
  if (json) headers["Content-Type"] = "application/json";

  const host = canonicalHostname(parsedUrl);
  if (host === "sec.gov" || host.endsWith(".sec.gov")) {
    requireHttps(parsedUrl, "sec.gov");
    // Only caller-supplied values satisfy SEC identity. Provider-specific
    // browser defaults are passed separately as `requestUserAgent`.
    const secUserAgent = normalizeDeclaredUserAgent(options.secUserAgent ?? options.userAgent);
    if (secUserAgent === undefined) {
      throw new XnewsFetchError(
        "config",
        'sec.gov requires a declared User-Agent with contact information; set secUserAgent, e.g. "myapp/1.0 ops@example.com"',
        { url },
      );
    }
    headers["User-Agent"] = secUserAgent;
  }

  if (host === "emma.msrb.org") {
    requireHttps(parsedUrl, "emma.msrb.org");
    // Accepting terms is the caller's recorded act, never this library's.
    if (options.msrbAcceptTermsOfUse !== true) {
      throw new XnewsFetchError(
        "config",
        "emma.msrb.org requires accepting the MSRB EMMA Terms of Use (https://emma.msrb.org); set msrbAcceptTermsOfUse: true to send the acceptance cookie",
        { url },
      );
    }
    headers["Cookie"] = "Disclaimer6=msrborg";
  }

  return headers;
}

function parseRequestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new XnewsFetchError("config", `Invalid request URL: ${redactUrl(value)}`, {
      url: value,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new XnewsFetchError(
      "config",
      `Unsupported request protocol ${url.protocol || "(none)"} for ${redactUrl(value)}`,
      { url: value },
    );
  }
  if (url.username || url.password) {
    throw new XnewsFetchError(
      "config",
      `Request URLs must not contain credentials: ${redactUrl(value)}`,
      { url: value },
    );
  }
  return url;
}

function canonicalHostname(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

function requireHttps(url: URL, providerHost: string): void {
  if (url.protocol === "https:") return;
  throw new XnewsFetchError(
    "config",
    `${providerHost} requires HTTPS; refused ${redactUrl(url.href)}`,
    { url: url.href },
  );
}

function normalizeDeclaredUserAgent(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return !normalized || hasAsciiControlCharacters(normalized) ? undefined : normalized;
}

function redactUrl(value: string): string {
  const withoutControls = stripAsciiControlCharacters(value);

  try {
    const url = new URL(withoutControls);
    url.username = "";
    url.password = "";
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, "<redacted>");
    }
    return url.href;
  } catch {
    return withoutControls;
  }
}
