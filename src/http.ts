import { redactUrl, XnewsFetchError } from "./errors.js";
import { hasAsciiControlCharacters } from "./text.js";
import type { ProviderError, SourceFetchOptions } from "./types.js";

export const DEFAULT_USER_AGENT = "xnews (+https://github.com/xbbg-org/xnews)";

/**
 * Some providers serve bot-shaped User-Agents an interstitial or a 403; they
 * get a browser-shaped string instead. Deliberately versionless: embedded
 * package versions drift the moment a release bumps the manifest.
 */
export const BROWSERISH_USER_AGENT = "Mozilla/5.0 (compatible; xnews)";

export { XnewsFetchError } from "./errors.js";

/** Maps an unknown thrown value onto the shared provider error taxonomy. */
export function providerErrorFromUnknown(error: unknown): ProviderError {
  if (error instanceof XnewsFetchError) {
    return {
      message: error.message,
      code: error.code,
      ...(error.status !== undefined ? { status: error.status } : {}),
      url: error.url,
    };
  }
  return { message: error instanceof Error ? error.message : String(error), code: "unknown" };
}

export async function fetchText(
  url: string,
  options: SourceFetchOptions = {},
  requestUserAgent = options.userAgent ?? DEFAULT_USER_AGENT,
): Promise<string> {
  const result = await requestRaw(
    url,
    options,
    requestUserAgent,
    options.userAgent !== undefined && requestUserAgent === options.userAgent,
  );
  return utf8Decoder.decode(result.bytes);
}

/**
 * GETs a URL announcing a JSON preference (`Accept: application/json`), with
 * `fetchText`'s timeout, abort, redirect, and error semantics. For APIs that
 * content-negotiate and would answer the default feed-oriented `Accept` with
 * XML or a browsable HTML page (e.g. SSRN, OSF).
 */
export async function fetchJsonText(
  url: string,
  options: SourceFetchOptions = {},
  requestUserAgent = options.userAgent ?? DEFAULT_USER_AGENT,
): Promise<string> {
  const result = await requestRaw(
    url,
    options,
    requestUserAgent,
    options.userAgent !== undefined && requestUserAgent === options.userAgent,
    undefined,
    { Accept: "application/json" },
  );
  return utf8Decoder.decode(result.bytes);
}

/**
 * POSTs a JSON body and returns the response text, with `fetchText`'s
 * timeout, abort, redirect, and error semantics. `init.headers` carries
 * per-request headers such as an `Authorization` bearer token; host policy
 * headers still win on collision.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: SourceFetchOptions = {},
  requestUserAgent = options.userAgent ?? DEFAULT_USER_AGENT,
  init: RawRequestInit = {},
): Promise<string> {
  const result = await requestRaw(
    url,
    options,
    init.userAgent ?? requestUserAgent,
    options.userAgent !== undefined && requestUserAgent === options.userAgent,
    { contentType: "application/json", content: JSON.stringify(body) },
    init.headers,
  );
  return utf8Decoder.decode(result.bytes);
}

/**
 * Raw terminal response of a governed request: undecoded bytes plus the
 * response facts binary transports need. `setCookies` collects `Set-Cookie`
 * values observed across every followed hop, in order, for callers that
 * must thread a session across stateful request chains (e.g. ASP.NET
 * postbacks); injected `fetch` implementations without `getSetCookie`
 * yield an empty list.
 */
export interface RawFetchResult {
  readonly bytes: Uint8Array;
  readonly contentType?: string;
  readonly contentDisposition?: string;
  readonly setCookies: readonly string[];
}

export interface RawRequestInit {
  /** Extra request headers; host policy headers always win on collision. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly userAgent?: string;
}

/** GETs a URL and returns the raw response, with `fetchText`'s semantics. */
export async function fetchRaw(
  url: string,
  options: SourceFetchOptions = {},
  init: RawRequestInit = {},
): Promise<RawFetchResult> {
  return requestRaw(
    url,
    options,
    init.userAgent ?? options.userAgent ?? DEFAULT_USER_AGENT,
    init.userAgent !== undefined || options.userAgent !== undefined,
    undefined,
    init.headers,
  );
}

/**
 * POSTs an `application/x-www-form-urlencoded` body and returns the raw
 * response, with `fetchText`'s timeout, abort, redirect, and error
 * semantics. A 303 (or a 301/302 answered to the POST) downgrades the
 * follow-up request to a bodyless GET, mirroring browser behavior.
 */
export async function postForm(
  url: string,
  form: Readonly<Record<string, string>>,
  options: SourceFetchOptions = {},
  init: RawRequestInit = {},
): Promise<RawFetchResult> {
  return requestRaw(
    url,
    options,
    init.userAgent ?? options.userAgent ?? DEFAULT_USER_AGENT,
    init.userAgent !== undefined || options.userAgent !== undefined,
    {
      contentType: "application/x-www-form-urlencoded",
      content: new URLSearchParams(form).toString(),
    },
    init.headers,
  );
}

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const SENSITIVE_QUERY_KEY =
  /(?:^|[_-])(?:api[_-]?key|auth|credential|password|secret|sig(?:nature)?|token)(?:$|[_-])/i;

interface RequestBody {
  readonly contentType: string;
  readonly content: string;
}

const utf8Decoder = new TextDecoder();

async function requestRaw(
  url: string,
  options: SourceFetchOptions,
  requestUserAgent: string,
  callerUserAgentWouldBeReapplied: boolean,
  body?: RequestBody,
  extraHeaders?: Readonly<Record<string, string>>,
): Promise<RawFetchResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new XnewsFetchError("config", "No fetch implementation is available in this runtime", {
      url,
    });
  }
  const maxResponseBytes = responseByteLimit(options.maxResponseBytes, url);

  let currentUrl = url;
  let method = body === undefined ? "GET" : "POST";
  let requestBody = body;
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
  const setCookies: string[] = [];

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      // Rebuild host-scoped policy headers before every hop. The injected
      // transport receives `manual`, so it cannot follow a destination before
      // SEC identity and EMMA consent are checked for that destination.
      // Caller-supplied extra headers never override policy headers.
      const headers = makeHeaders(
        currentUrl,
        options,
        requestBody?.contentType,
        requestUserAgent,
        extraHeaders,
      );
      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
          headers,
          ...(requestBody === undefined ? {} : { method, body: requestBody.content }),
        });
      } catch {
        const displayUrl = redactUrl(currentUrl);
        throw new XnewsFetchError(
          "network",
          `${method} ${displayUrl} failed: network request failed`,
          { url: currentUrl },
        );
      }

      setCookies.push(...(response.headers.getSetCookie?.() ?? []));

      if (REDIRECT_STATUSES.has(response.status)) {
        cancelDiscardedResponseBody(response);
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

        let redirectUrl: URL;
        try {
          redirectUrl = new URL(location, currentUrl);
        } catch {
          const displayUrl = redactUrl(currentUrl);
          throw new XnewsFetchError(
            "network",
            `${method} ${displayUrl} failed: invalid redirect location`,
            { url: currentUrl },
          );
        }
        assertSafeRedirect(
          parseRequestUrl(currentUrl),
          parseRequestUrl(redirectUrl.href),
          method,
          extraHeaders,
          callerUserAgentWouldBeReapplied,
          options.allowCrossOriginRedirects === true,
        );
        currentUrl = redirectUrl.href;
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) && method === "POST")
        ) {
          method = "GET";
          requestBody = undefined;
        }
        continue;
      }

      if (!response.ok) {
        cancelDiscardedResponseBody(response);
        throw httpStatusError(method, currentUrl, response);
      }
      const bytes = await readResponseBytes(response, maxResponseBytes, method, currentUrl);
      const contentType = response.headers.get("content-type");
      const contentDisposition = response.headers.get("content-disposition");
      return {
        bytes,
        ...(contentType === null ? {} : { contentType }),
        ...(contentDisposition === null ? {} : { contentDisposition }),
        setCookies,
      };
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

function cancelDiscardedResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {
      // The governing policy outcome remains authoritative if cancellation fails.
    });
  } catch {
    // The governing policy outcome remains authoritative if cancellation throws.
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

function responseByteLimit(value: number | undefined, url: string): number {
  if (value === undefined) return DEFAULT_MAX_RESPONSE_BYTES;
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new XnewsFetchError(
    "config",
    `Invalid maxResponseBytes for ${redactUrl(url)}: expected a non-negative safe integer`,
    { url },
  );
}

async function readResponseBytes(
  response: Response,
  maxResponseBytes: number,
  method: string,
  url: string,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length")?.trim();
  if (
    declaredLength !== undefined &&
    /^[0-9]+$/.test(declaredLength) &&
    Number(declaredLength) > maxResponseBytes
  ) {
    cancelDiscardedResponseBody(response);
    throw responseTooLargeError(method, url, maxResponseBytes);
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxResponseBytes) {
      throw responseTooLargeError(method, url, maxResponseBytes);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > maxResponseBytes) {
        try {
          void reader.cancel().catch(() => {
            // The size-policy failure remains authoritative if cancellation fails.
          });
        } catch {
          // The size-policy failure remains authoritative if cancellation throws.
        }
        throw responseTooLargeError(method, url, maxResponseBytes);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0]!;
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseTooLargeError(
  method: string,
  url: string,
  maxResponseBytes: number,
): XnewsFetchError {
  return new XnewsFetchError(
    "network",
    `${method} ${redactUrl(url)} failed: response exceeds ${maxResponseBytes} byte limit`,
    { url },
  );
}

function assertSafeRedirect(
  current: URL,
  target: URL,
  method: string,
  extraHeaders: Readonly<Record<string, string>> | undefined,
  callerUserAgentWouldBeReapplied: boolean,
  allowCrossOrigin: boolean,
): void {
  // A redirect into a private address is refused regardless: that one is a
  // hazard to the caller, not a policy choice they can opt out of.
  if (isBlockedRedirectTarget(target)) {
    throw refusedRedirectError(method, target, "redirect target is not a public network address");
  }
  if (allowCrossOrigin) return;
  if (current.protocol === "https:" && target.protocol === "http:") {
    throw refusedRedirectError(method, target, "HTTPS-to-HTTP redirects are not allowed");
  }
  if (current.origin === target.origin) return;
  if (callerUserAgentWouldBeReapplied) {
    throw refusedRedirectError(
      method,
      target,
      "cross-origin redirects are not allowed for caller-supplied User-Agent identities",
    );
  }
  if (hasSensitiveQueryParameter(current)) {
    throw refusedRedirectError(
      method,
      target,
      "cross-origin redirects are not allowed for URLs with sensitive query parameters",
    );
  }
  if (method !== "GET" && method !== "HEAD") {
    throw refusedRedirectError(
      method,
      target,
      "cross-origin redirects are not allowed for requests with bodies",
    );
  }
  if (extraHeaders !== undefined && Object.keys(extraHeaders).length > 0) {
    throw refusedRedirectError(
      method,
      target,
      "cross-origin redirects are not allowed for requests with caller-supplied headers",
    );
  }
}

function refusedRedirectError(method: string, target: URL, reason: string): XnewsFetchError {
  return new XnewsFetchError(
    "network",
    `${method} redirect to ${redactUrl(target.href)} refused: ${reason}`,
    { url: target.href },
  );
}

function hasSensitiveQueryParameter(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) return true;
  }
  return false;
}

function isBlockedRedirectTarget(url: URL): boolean {
  const hostname = canonicalHostname(url);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;

  const ipv4 = parseIpv4Address(hostname);
  if (ipv4 !== undefined) return isBlockedIpv4Address(ipv4);

  const ipv6 = parseIpv6Address(hostname);
  return ipv6 !== undefined && isBlockedIpv6Address(ipv6);
}

type Ipv4Address = readonly [number, number, number, number];
type Ipv6Address = readonly [number, number, number, number, number, number, number, number];
function hasIpv4AddressLength(values: readonly number[]): values is Ipv4Address {
  return values.length === 4;
}

function hasIpv6AddressLength(values: readonly number[]): values is Ipv6Address {
  return values.length === 8;
}

function parseIpv4Address(hostname: string): Ipv4Address | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    octets.push(octet);
  }
  return hasIpv4AddressLength(octets) ? octets : undefined;
}

function isBlockedIpv4Address([a, b, c, d]: Ipv4Address): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return d !== 9 && d !== 10;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  return a === 203 && b === 0 && c === 113;
}

function parseIpv6Address(hostname: string): Ipv6Address | undefined {
  const value =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!value.includes(":")) return undefined;

  const separator = value.indexOf("::");
  if (separator !== value.lastIndexOf("::")) return undefined;
  if (separator === -1) {
    const groups = parseIpv6Groups(value);
    return groups !== undefined && hasIpv6AddressLength(groups) ? groups : undefined;
  }

  const left = parseIpv6Groups(value.slice(0, separator));
  const right = parseIpv6Groups(value.slice(separator + 2));
  if (left === undefined || right === undefined) return undefined;
  const missingGroups = 8 - left.length - right.length;
  if (missingGroups < 1) return undefined;
  const groups = [...left, ...Array.from({ length: missingGroups }, () => 0), ...right];
  return hasIpv6AddressLength(groups) ? groups : undefined;
}

function parseIpv6Groups(value: string): number[] | undefined {
  if (value === "") return [];
  const groups: number[] = [];
  for (const group of value.split(":")) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
    groups.push(Number.parseInt(group, 16));
  }
  return groups;
}

function isBlockedIpv6Address(address: Ipv6Address): boolean {
  const [a, b, c, d, e, f, g, h] = address;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    return isBlockedIpv4Address([g >>> 8, g & 0xff, h >>> 8, h & 0xff]);
  }

  // Public IPv6 unicast space is 2000::/3. The exclusions below are
  // special-purpose allocations inside that otherwise-public range.
  if ((a & 0xe000) !== 0x2000) return true;
  if (a === 0x2001 && b < 0x0200) return true;
  if (a === 0x2001 && b === 0x0db8) return true;
  if (a === 0x2002) return true;
  return a === 0x3fff && (b & 0xf000) === 0;
}

function makeHeaders(
  url: string,
  options: SourceFetchOptions,
  bodyContentType: string | undefined,
  requestUserAgent: string,
  extraHeaders?: Readonly<Record<string, string>>,
): Record<string, string> {
  const parsedUrl = parseRequestUrl(url);
  // Layering: transport defaults, then caller extras, then host policy —
  // extras may retune Accept, but SEC identity and EMMA consent always win.
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.5",
    "User-Agent": requestUserAgent,
    ...extraHeaders,
  };
  if (bodyContentType !== undefined) headers["Content-Type"] = bodyContentType;

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
