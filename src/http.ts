import type { SourceFetchOptions } from "./types";

const DEFAULT_USER_AGENT = "xnews/0.1.0 (+public market news research)";
const DEFAULT_SEC_USER_AGENT = "xnews/0.1.0 contact@example.com";

export async function fetchText(url: string, options: SourceFetchOptions = {}): Promise<string> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("No fetch implementation is available in this runtime");
  }

  if (options.signal?.aborted) {
    throw new Error(`GET ${url} aborted before request`);
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
      headers: makeHeaders(url, options),
    });

    if (!response.ok) {
      throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    if (timedOut) {
      throw new Error(`GET ${url} timed out after ${timeoutMs}ms`, { cause: error });
    }
    if (options.signal?.aborted) {
      throw new Error(`GET ${url} aborted`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", upstreamAbort);
  }
}

function makeHeaders(url: string, options: SourceFetchOptions): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.5",
    "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
  };

  const host = new URL(url).hostname;
  if (host.endsWith("sec.gov")) {
    headers["User-Agent"] = options.secUserAgent ?? options.userAgent ?? DEFAULT_SEC_USER_AGENT;
  }

  return headers;
}
