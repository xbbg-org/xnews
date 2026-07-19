import type { SourceFetchOptions } from "./types";

const DEFAULT_USER_AGENT = "xnews/0.1.0 (+public market news research)";
const DEFAULT_SEC_USER_AGENT = "xnews/0.1.0 contact@example.com";

export async function fetchText(url: string, options: SourceFetchOptions = {}): Promise<string> {
  return requestText(url, options);
}

/**
 * POSTs a JSON body and returns the response text, with `fetchText`'s
 * timeout, abort, and error semantics.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: SourceFetchOptions = {},
): Promise<string> {
  return requestText(url, options, JSON.stringify(body));
}

async function requestText(
  url: string,
  options: SourceFetchOptions,
  jsonBody?: string,
): Promise<string> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("No fetch implementation is available in this runtime");
  }

  const method = jsonBody === undefined ? "GET" : "POST";
  if (options.signal?.aborted) {
    throw new Error(`${method} ${url} aborted before request`);
  }

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
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: makeHeaders(url, options, jsonBody !== undefined),
      ...(jsonBody === undefined ? {} : { method, body: jsonBody }),
    });

    if (!response.ok) {
      throw new Error(`${method} ${url} failed: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    if (timedOut) {
      throw new Error(`${method} ${url} timed out after ${timeoutMs}ms`, { cause: error });
    }
    if (options.signal?.aborted) {
      throw new Error(`${method} ${url} aborted`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", upstreamAbort);
  }
}

function makeHeaders(url: string, options: SourceFetchOptions, json: boolean): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.5",
    "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
  };
  if (json) {
    headers["Content-Type"] = "application/json";
  }

  const host = new URL(url).hostname;
  if (host.endsWith("sec.gov")) {
    headers["User-Agent"] = options.secUserAgent ?? options.userAgent ?? DEFAULT_SEC_USER_AGENT;
  }
  // EMMA serves its Terms-of-Use interstitial page instead of data until the
  // ToU acceptance cookie is present; the server only checks its existence.
  if (host === "emma.msrb.org") {
    headers["Cookie"] = "Disclaimer6=msrborg";
  }

  return headers;
}
