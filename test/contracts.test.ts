import { expect, test } from "bun:test";
import {
  FIXED_FEEDS,
  FIXED_FEED_PROVIDERS,
  NEWS_ITEM_ID_SCHEME_VERSION,
  PROVIDER_POLICIES,
  PUBLISHED_AT_PARSER_VERSION,
  parsePublishedAt,
} from "../src/catalog.js";
import type { FixedFeedDefinition } from "../src/catalog.js";
import {
  buildCompanyNewsFeedResult,
  buildTopicNewsFeedResult,
  parseBingNews,
  resolveYoutubeChannelId,
  parseYoutubeChannelVideos,
  XnewsFetchError,
} from "../src/index.js";
import type { ProviderResult } from "../src/index.js";
import { fetchText } from "../src/http.js";
import { parseAtomEntries, parseRssItems } from "../src/parsers.js";

const googleWindowFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Acme dated event</title>
    <link>https://example.com/dated</link>
    <guid>dated</guid>
    <pubDate>Tue, 07 Jul 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Acme undated event</title>
    <link>https://example.com/undated</link>
    <guid>undated</guid>
  </item>
</channel></rss>`;

async function captureXnewsError(promise: Promise<unknown>): Promise<XnewsFetchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof XnewsFetchError) return error;
    throw error;
  }
  throw new Error("Expected XnewsFetchError");
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

test("transport enforces redirect semantics before the injected fetch", async () => {
  let requestInit: RequestInit | undefined;
  const text = await fetchText("https://example.com/feed", {
    redirect: "manual",
    fetch: async (_input, init) => {
      requestInit = init;
      return new Response("ok");
    },
  });

  expect(text).toBe("ok");
  expect(requestInit?.redirect).toBe("manual");

  const failure = await captureXnewsError(
    fetchText("https://example.com/rate-limited", {
      fetch: async () =>
        new Response("slow down", { status: 429, statusText: "proxy token=secret" }),
    }),
  );
  expect(failure).toMatchObject({
    code: "http_status",
    status: 429,
    url: "https://example.com/rate-limited",
  });
  expect(failure.message).not.toContain("secret");
});

test("redirect hops reapply protected-host policy and strip scoped headers", async () => {
  const blockedRequests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  const blocked = await captureXnewsError(
    fetchText("https://example.com/start", {
      fetch: async (input, init) => {
        blockedRequests.push({ url: requestUrl(input), ...(init ? { init } : {}) });
        return new Response(null, {
          status: 302,
          headers: { Location: "https://www.sec.gov./Archives/redirected" },
        });
      },
    }),
  );
  expect(blocked).toMatchObject({
    code: "config",
    url: "https://www.sec.gov./Archives/redirected",
  });
  expect(blockedRequests).toHaveLength(1);
  expect(blockedRequests[0]?.init?.redirect).toBe("manual");

  const escapedRequests: Array<{ readonly url: string; readonly headers: Headers }> = [];
  const body = await fetchText("https://www.sec.gov/start", {
    secUserAgent: "xnews-contract-test/1.0 tests@example.com",
    fetch: async (input, init) => {
      const request = { url: requestUrl(input), headers: new Headers(init?.headers) };
      escapedRequests.push(request);
      return request.url.includes("sec.gov")
        ? new Response(null, {
            status: 302,
            headers: { Location: "https://example.com/final" },
          })
        : new Response("done");
    },
  });
  expect(body).toBe("done");
  expect(escapedRequests[0]?.headers.get("User-Agent")).toBe(
    "xnews-contract-test/1.0 tests@example.com",
  );
  expect(escapedRequests[1]?.headers.get("User-Agent")).not.toBe(
    "xnews-contract-test/1.0 tests@example.com",
  );
});

test("SEC and EMMA policy preconditions fail before network I/O", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => {
    calls += 1;
    return new Response("ok");
  };

  const secFailure = await captureXnewsError(
    fetchText("https://www.sec.gov/Archives/test", { fetch }),
  );
  expect(secFailure).toMatchObject({
    code: "config",
    url: "https://www.sec.gov/Archives/test",
  });
  const emmaFailure = await captureXnewsError(
    fetchText("https://emma.msrb.org/IssueView/test", { fetch }),
  );
  expect(emmaFailure).toMatchObject({
    code: "config",
    url: "https://emma.msrb.org/IssueView/test",
  });
  expect(calls).toBe(0);
  await captureXnewsError(fetchText("https://www.sec.gov./Archives/test", { fetch }));
  await captureXnewsError(fetchText("http://www.sec.gov/Archives/test", { fetch }));
  await captureXnewsError(
    fetchText("https://www.sec.gov/Archives/test", { secUserAgent: "   ", fetch }),
  );
  await captureXnewsError(fetchText("https://emma.msrb.org./IssueView/test", { fetch }));
  expect(calls).toBe(0);
});

test("provider policy headers require exact provider domains", async () => {
  const requests: RequestInit[] = [];
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(init ?? {});
    return new Response("ok");
  };

  await fetchText("https://www.sec.gov/Archives/test", {
    secUserAgent: "xnews-contract-test/1.0 tests@example.com",
    fetch,
  });
  await fetchText("https://emma.msrb.org/IssueView/test", {
    msrbAcceptTermsOfUse: true,
    fetch,
  });
  await fetchText("https://notsec.gov/feed", {
    secUserAgent: "must-not-leak@example.com",
    fetch,
  });

  expect(new Headers(requests[0]?.headers).get("User-Agent")).toBe(
    "xnews-contract-test/1.0 tests@example.com",
  );
  expect(new Headers(requests[1]?.headers).get("Cookie")).toBe("Disclaimer6=msrborg");
  expect(new Headers(requests[2]?.headers).get("User-Agent")).not.toBe("must-not-leak@example.com");
});

test("typed errors redact untrusted transport details", async () => {
  const request = "https://example.com/feed?token=secret&q=visible";
  const failure = await captureXnewsError(
    fetchText(request, {
      fetch: async (input) => {
        throw new Error(`proxy failed ${requestUrl(input)}\nInjected header`);
      },
    }),
  );

  expect(failure.url).toContain("q=visible");
  expect(failure.url).not.toContain("secret");
  expect(failure.message).not.toContain("secret");
  expect(failure.message).not.toContain("Injected header");
  expect(failure.cause).toBeUndefined();

  const result = await buildTopicNewsFeedResult({
    query: "Acme",
    sources: ["google-news"],
    fetch: async () => {
      throw new Error("proxy leaked https://example.com?token=secret\nInjected header");
    },
  });
  expect(result.providers[0]?.warnings.join(" ")).not.toContain("secret");
  expect(result.providers[0]?.warnings.join(" ")).not.toContain("Injected header");
  expect(result.providers[0]?.error?.message).not.toContain("secret");
});

test("feed results expose disabled config failures without dialing", async () => {
  let calls = 0;
  const result = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    sources: ["sec-edgar"],
    fetch: async () => {
      calls += 1;
      return new Response("unexpected");
    },
  });

  expect(calls).toBe(0);
  expect(result.providers[0]).toMatchObject({
    provider: "sec-edgar",
    status: "disabled",
    itemCount: 0,
    undatedExcluded: 0,
    error: {
      code: "config",
      url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=RGA&count=40&output=atom",
    },
  });
});

test("date parser reports deterministic format and version", () => {
  expect(PUBLISHED_AT_PARSER_VERSION).toBe(1);
  expect(parsePublishedAt("2026-07-07T12:30:45.123456Z")).toEqual({
    instant: "2026-07-07T12:30:45.123Z",
    format: "iso_8601",
  });
  expect(parsePublishedAt("2026-07-07T12:30:45-04:00")).toEqual({
    instant: "2026-07-07T16:30:45.000Z",
    format: "iso_8601",
  });
  expect(parsePublishedAt("Tue, 7 Jul 26 12:30 EDT")).toEqual({
    instant: "2026-07-07T16:30:00.000Z",
    format: "rfc_822",
  });
  expect(parsePublishedAt("2026-07-07")).toEqual({
    instant: "2026-07-07T00:00:00.000Z",
    format: "date_only",
  });
  expect(parsePublishedAt("Jul-02-26 08:00AM")).toEqual({
    instant: "2026-07-02T12:00:00.000Z",
    format: "finviz",
  });
  expect(parsePublishedAt("Mar-08-26 05:00AM")?.instant).toBe("2026-03-08T09:00:00.000Z");
  expect(parsePublishedAt("Nov-01-26 03:00AM")?.instant).toBe("2026-11-01T08:00:00.000Z");
  expect(parsePublishedAt("Mar-08-26 02:30AM")).toBeNull();
  expect(parsePublishedAt("20260623T161500Z")).toEqual({
    instant: "2026-06-23T16:15:00.000Z",
    format: "gdelt",
  });
  expect(parsePublishedAt("/Date(1784431894000)/")).toEqual({
    instant: "2026-07-19T03:31:34.000Z",
    format: "dotnet",
  });
  expect(parsePublishedAt("0099-07-07T12:30:45Z")?.instant).toBe("0099-07-07T12:30:45.000Z");
  expect(parsePublishedAt("2024-02-29")).not.toBeNull();
  expect(parsePublishedAt("2025-02-29")).toBeNull();
  expect(parsePublishedAt("2026-02-30")).toBeNull();
  expect(parsePublishedAt("2026-07-07T12:30:45+24:00")).toBeNull();
  expect(parsePublishedAt("not a date")).toBeNull();
});

test("bounded feeds report undated exclusions", async () => {
  const result = await buildTopicNewsFeedResult({
    query: "Acme",
    sources: ["google-news"],
    since: "2026-07-01T00:00:00Z",
    fetch: async () => new Response(googleWindowFixture),
  });

  expect(result.items.map((item) => item.title)).toEqual(["Acme dated event"]);
  expect(result.providers[0]).toMatchObject({
    provider: "google-news",
    status: "ok",
    itemCount: 1,
    undatedExcluded: 1,
  });
});

test("parsers omit unsafe item URLs and Bing lookalikes", () => {
  const rss = parseRssItems(
    `<rss><channel>
      <item><title>Unsafe script</title><link>javascript:alert(1)</link></item>
      <item><title>Unsafe credentials</title><link>https://user:pass@example.com/a</link></item>
      <item><title>Safe</title><link>https://example.com/safe</link></item>
    </channel></rss>`,
    { provider: "google-news", sourceFallback: "test" },
  );
  const atom = parseAtomEntries(
    `<feed>
      <entry><title>Unsafe data</title><link href="data:text/html,bad"/></entry>
      <entry><title>Safe</title><link href="https://example.com/atom"/></entry>
    </feed>`,
    { provider: "sec-edgar", sourceFallback: "test" },
  );
  expect(rss.map((item) => item.url)).toEqual(["https://example.com/safe"]);
  expect(atom.map((item) => item.url)).toEqual(["https://example.com/atom"]);

  const unsafeTarget =
    "https://www.bing.com/news/apiclick.aspx?url=" + encodeURIComponent("javascript:alert(1)");
  const lookalike =
    "https://attackerbing.com/news?url=" + encodeURIComponent("https://example.com/target");
  const bing = parseBingNews(
    `<rss><channel>
      <item><title>Unsafe target</title><link>${unsafeTarget}</link></item>
      <item><title>Lookalike</title><link>${lookalike}</link></item>
    </channel></rss>`,
  );
  expect(bing.map((item) => item.url)).toEqual([unsafeTarget, lookalike]);

  const youtube = parseYoutubeChannelVideos(
    `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
      <entry><title>Unsafe</title><yt:videoId>unsafeVid11</yt:videoId><link rel="alternate" href="javascript:alert(1)"/></entry>
      <entry><title>Credentialed</title><yt:videoId>credsVideo1</yt:videoId><link rel="alternate" href="https://user:pass@www.youtube.com/watch?v=credsVideo1"/></entry>
      <entry><title>Fallback</title><yt:videoId>safeVideo11</yt:videoId></entry>
    </feed>`,
  );
  expect(youtube.map((item) => item.url)).toEqual(["https://www.youtube.com/watch?v=safeVideo11"]);
});

test("YouTube channel resolution rejects off-origin URLs before fetching", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => {
    calls += 1;
    return new Response("unexpected");
  };
  const invalidChannels = [
    "http://www.youtube.com/@marketminute",
    "https://127.0.0.1/@marketminute",
    "https://169.254.169.254/latest/meta-data",
    "https://attacker-youtube.com/@marketminute",
    "https://www.youtube.com./@marketminute",
    "https://user:password@www.youtube.com/@marketminute",
    "https://www.youtube.com:444/@marketminute",
    "https://www.youtube.com/@marketminute#fragment",
    "javascript:alert(1)",
  ];

  for (const channel of invalidChannels) {
    let failure: unknown;
    try {
      await resolveYoutubeChannelId(channel, { fetch });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TypeError);
  }
  expect(calls).toBe(0);
});

test("catalog records provider and fixed-feed operating policy", () => {
  expect(NEWS_ITEM_ID_SCHEME_VERSION).toBe(1);
  expect(PROVIDER_POLICIES["sec-edgar"]).toMatchObject({
    maxRequestsPerSecond: 10,
    requiresDeclaredUserAgent: true,
  });
  expect(PROVIDER_POLICIES["msrb-emma"]?.requiresTermsAcceptance).toBe("https://emma.msrb.org");

  for (const provider of FIXED_FEED_PROVIDERS) {
    expect(FIXED_FEEDS[provider].suggestedMinPollSeconds).toBeGreaterThanOrEqual(300);
  }
});

test("new result fields preserve legacy public shape assignability", () => {
  const legacyResult: ProviderResult = {
    provider: "google-news",
    status: "empty",
    capabilities: ["topic"],
    itemCount: 0,
    items: [],
    warnings: [],
    fetchedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 0,
    requestUrls: [],
  };
  const legacyFeed: FixedFeedDefinition = { label: "Legacy", urls: [] };

  expect(legacyResult.provider).toBe("google-news");
  expect(legacyFeed.label).toBe("Legacy");
});
