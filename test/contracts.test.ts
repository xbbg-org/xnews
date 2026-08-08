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
import { fetchRaw, fetchText, postJson } from "../src/http.js";
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

test("transport cancels discarded redirect and error response bodies", async () => {
  let followedRedirectCancellations = 0;
  let followedCalls = 0;
  const pendingCancellation = Promise.withResolvers<void>().promise;
  const followedRedirectBody = new ReadableStream<Uint8Array>({
    cancel() {
      followedRedirectCancellations += 1;
      return pendingCancellation;
    },
  });
  const followed = await fetchText("https://example.com/redirect-start", {
    fetch: async (input) => {
      followedCalls += 1;
      if (requestUrl(input) === "https://example.com/redirect-start") {
        return new Response(followedRedirectBody, {
          status: 302,
          headers: { Location: "https://example.com/redirect-final" },
        });
      }
      expect(followedRedirectCancellations).toBe(1);
      return new Response("done");
    },
  });
  expect(followed).toBe("done");
  expect(followedCalls).toBe(2);
  expect(followedRedirectCancellations).toBe(1);

  let refusedRedirectCancellations = 0;
  const refusedRedirectBody = new ReadableStream<Uint8Array>({
    cancel() {
      refusedRedirectCancellations += 1;
      throw new Error("redirect cancellation failed");
    },
  });
  const refusedRedirect = await captureXnewsError(
    fetchText("https://example.com/refused-redirect", {
      redirect: "error",
      fetch: async () =>
        new Response(refusedRedirectBody, {
          status: 302,
          headers: { Location: "https://example.com/not-followed" },
        }),
    }),
  );
  expect(refusedRedirect).toMatchObject({
    code: "network",
    url: "https://example.com/refused-redirect",
  });
  expect(refusedRedirect.status).toBeUndefined();
  expect(refusedRedirectCancellations).toBe(1);

  let statusCancellations = 0;
  const statusBody = new ReadableStream<Uint8Array>({
    cancel() {
      statusCancellations += 1;
      throw new Error("status cancellation failed");
    },
  });
  const statusFailure = await captureXnewsError(
    fetchText("https://example.com/unavailable", {
      fetch: async () => new Response(statusBody, { status: 503 }),
    }),
  );
  expect(statusFailure).toMatchObject({
    code: "http_status",
    status: 503,
    url: "https://example.com/unavailable",
  });
  expect(statusCancellations).toBe(1);
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

test("redirect policy rejects downgrade and non-public literal targets", async () => {
  const blockedTargets = [
    "http://www.bis.org/insecure",
    "https://localhost/internal",
    "https://127.0.0.1/internal",
    "https://10.0.0.1/internal",
    "https://169.254.1.1/internal",
    "https://224.0.0.1/internal",
    "https://192.0.2.1/internal",
    "https://[::1]/internal",
    "https://[fc00::1]/internal",
    "https://[fe80::1]/internal",
    "https://[ff00::1]/internal",
    "https://[2001:db8::1]/internal",
  ] as const;

  for (const target of blockedTargets) {
    let calls = 0;
    const failure = await captureXnewsError(
      fetchText("https://example.com/start", {
        fetch: async () => {
          calls += 1;
          return new Response(null, { status: 302, headers: { Location: target } });
        },
      }),
    );
    expect(failure).toMatchObject({ code: "network", url: target });
    expect(calls).toBe(1);
  }
});

test("redirect policy blocks sensitive cross-origin hops but allows public HTTPS hops", async () => {
  const secret = "credential-must-not-leak";
  let blockedCalls = 0;
  const blocked = await captureXnewsError(
    fetchText(`https://example.com/start?api_key=${secret}`, {
      fetch: async () => {
        blockedCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: "https://www.bis.org/final" },
        });
      },
    }),
  );
  expect(blocked).toMatchObject({
    code: "network",
    url: "https://www.bis.org/final",
  });
  expect(blocked.message).not.toContain(secret);
  expect(blocked.url).not.toContain(secret);
  expect(blockedCalls).toBe(1);

  const requests: string[] = [];
  const body = await fetchText(
    "https://example.com/start",
    {
      fetch: async (input) => {
        const request = requestUrl(input);
        requests.push(request);
        return request === "https://example.com/start"
          ? new Response(null, {
              status: 302,
              headers: { Location: "https://www.bis.org/final" },
            })
          : new Response("public response");
      },
    },
    "xnews-internal-contract-agent",
  );
  expect(body).toBe("public response");
  expect(requests).toEqual(["https://example.com/start", "https://www.bis.org/final"]);
});

test("redirect policy blocks cross-origin bodies and caller-supplied headers", async () => {
  const secret = "request-credential-must-not-leak";
  let postCalls = 0;
  const postFailure = await captureXnewsError(
    postJson(
      "https://example.com/start",
      { token: secret },
      {
        fetch: async () => {
          postCalls += 1;
          return new Response(null, {
            status: 307,
            headers: { Location: "https://www.bis.org/final" },
          });
        },
      },
    ),
  );
  expect(postFailure).toMatchObject({
    code: "network",
    url: "https://www.bis.org/final",
  });
  expect(postFailure.message).not.toContain(secret);
  expect(postCalls).toBe(1);

  for (const header of [
    "Authorization",
    "Proxy-Authorization",
    "Cookie",
    "X-Api-Key",
    "Api-Key",
    "X-Auth-Token",
  ]) {
    let calls = 0;
    const failure = await captureXnewsError(
      fetchRaw(
        "https://example.com/start",
        {
          fetch: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { Location: "https://www.bis.org/final" },
            });
          },
        },
        { headers: { [header]: secret } },
      ),
    );
    expect(failure).toMatchObject({
      code: "network",
      url: "https://www.bis.org/final",
    });
    expect(failure.message).not.toContain(secret);
    expect(calls).toBe(1);
  }
});

test("redirect policy never reapplies caller-supplied User-Agent identities cross-origin", async () => {
  const target = "https://www.bis.org/final";
  const identity = "caller-identity/1.0 secret@example.com";

  let optionCalls = 0;
  const optionFailure = await captureXnewsError(
    fetchText("https://example.com/options-user-agent", {
      userAgent: identity,
      fetch: async () => {
        optionCalls += 1;
        return new Response(null, { status: 302, headers: { Location: target } });
      },
    }),
  );
  expect(optionFailure).toMatchObject({ code: "network", url: target });
  expect(optionFailure.message).not.toContain(identity);
  expect(optionCalls).toBe(1);

  let rawInitCalls = 0;
  const rawInitFailure = await captureXnewsError(
    fetchRaw(
      "https://example.com/raw-init-user-agent",
      {
        fetch: async () => {
          rawInitCalls += 1;
          return new Response(null, { status: 302, headers: { Location: target } });
        },
      },
      { userAgent: identity },
    ),
  );
  expect(rawInitFailure).toMatchObject({ code: "network", url: target });
  expect(rawInitFailure.message).not.toContain(identity);
  expect(rawInitCalls).toBe(1);

  let secFallbackCalls = 0;
  const secFallbackFailure = await captureXnewsError(
    fetchText("https://www.sec.gov/Archives/options-user-agent", {
      userAgent: identity,
      fetch: async () => {
        secFallbackCalls += 1;
        return new Response(null, { status: 302, headers: { Location: target } });
      },
    }),
  );
  expect(secFallbackFailure).toMatchObject({ code: "network", url: target });
  expect(secFallbackFailure.message).not.toContain(identity);
  expect(secFallbackCalls).toBe(1);
});

test("transport enforces declared and streamed response byte limits", async () => {
  let declaredLengthCanceled = 0;
  const declaredLengthBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([115, 101, 99, 114, 101, 116]));
    },
    cancel() {
      declaredLengthCanceled += 1;
    },
  });
  const declaredLengthFailure = await captureXnewsError(
    fetchText("https://example.com/declared?token=credential-must-not-leak", {
      maxResponseBytes: 5,
      fetch: async () =>
        new Response(declaredLengthBody, {
          headers: { "Content-Length": "6" },
        }),
    }),
  );
  expect(declaredLengthFailure.code).toBe("network");
  expect(declaredLengthFailure.url).toBe("https://example.com/declared?token=%3Credacted%3E");
  expect(declaredLengthFailure.message).not.toContain("credential-must-not-leak");
  expect(declaredLengthFailure.message).not.toContain("secret");
  expect(declaredLengthCanceled).toBe(1);

  let streamedCanceled = 0;
  const streamedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([115, 101, 99]));
      controller.enqueue(new Uint8Array([114, 101, 116]));
    },
    cancel() {
      streamedCanceled += 1;
    },
  });
  const streamedFailure = await captureXnewsError(
    fetchText("https://example.com/streamed", {
      maxResponseBytes: 5,
      fetch: async () => new Response(streamedBody),
    }),
  );
  expect(streamedFailure).toMatchObject({
    code: "network",
    url: "https://example.com/streamed",
  });
  expect(streamedFailure.message).not.toContain("secret");
  expect(streamedCanceled).toBe(1);

  const atCallerLimit = await fetchText("https://example.com/override", {
    maxResponseBytes: 6,
    fetch: async () =>
      new Response("secret", {
        headers: { "Content-Length": "6" },
      }),
  });
  expect(atCallerLimit).toBe("secret");
});

test("response-size cancellation never delays or replaces the policy failure", async () => {
  const pendingCancellation = Promise.withResolvers<void>().promise;
  let pendingDeclaredCancellations = 0;
  const pendingDeclaredBody = new ReadableStream<Uint8Array>({
    cancel() {
      pendingDeclaredCancellations += 1;
      return pendingCancellation;
    },
  });
  const pendingDeclaredFailure = await captureXnewsError(
    fetchText("https://example.com/pending-declared", {
      maxResponseBytes: 1,
      fetch: async () => new Response(pendingDeclaredBody, { headers: { "Content-Length": "2" } }),
    }),
  );
  expect(pendingDeclaredFailure).toMatchObject({
    code: "network",
    url: "https://example.com/pending-declared",
  });
  expect(pendingDeclaredFailure.message).toContain(
    "response exceeds the 1 byte maxResponseBytes limit",
  );
  expect(pendingDeclaredCancellations).toBe(1);

  let rejectedDeclaredCancellations = 0;
  const rejectedDeclaredBody = new ReadableStream<Uint8Array>({
    cancel() {
      rejectedDeclaredCancellations += 1;
      throw new Error("declared cancellation rejection");
    },
  });
  const rejectedDeclaredFailure = await captureXnewsError(
    fetchText("https://example.com/rejected-declared", {
      maxResponseBytes: 1,
      fetch: async () => new Response(rejectedDeclaredBody, { headers: { "Content-Length": "2" } }),
    }),
  );
  expect(rejectedDeclaredFailure).toMatchObject({
    code: "network",
    url: "https://example.com/rejected-declared",
  });
  expect(rejectedDeclaredFailure.message).toContain(
    "response exceeds the 1 byte maxResponseBytes limit",
  );
  expect(rejectedDeclaredFailure.message).not.toContain("cancellation rejection");
  expect(rejectedDeclaredCancellations).toBe(1);

  let pendingStreamedCancellations = 0;
  const pendingStreamedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
    },
    cancel() {
      pendingStreamedCancellations += 1;
      return pendingCancellation;
    },
  });
  const pendingStreamedFailure = await captureXnewsError(
    fetchText("https://example.com/pending-streamed", {
      maxResponseBytes: 1,
      fetch: async () => new Response(pendingStreamedBody),
    }),
  );
  expect(pendingStreamedFailure).toMatchObject({
    code: "network",
    url: "https://example.com/pending-streamed",
  });
  expect(pendingStreamedFailure.message).toContain(
    "response exceeds the 1 byte maxResponseBytes limit",
  );
  expect(pendingStreamedCancellations).toBe(1);

  let rejectedStreamedCancellations = 0;
  const rejectedStreamedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
    },
    cancel() {
      rejectedStreamedCancellations += 1;
      return Promise.reject(new Error("streamed cancellation rejection"));
    },
  });
  const rejectedStreamedFailure = await captureXnewsError(
    fetchText("https://example.com/rejected-streamed", {
      maxResponseBytes: 1,
      fetch: async () => new Response(rejectedStreamedBody),
    }),
  );
  expect(rejectedStreamedFailure).toMatchObject({
    code: "network",
    url: "https://example.com/rejected-streamed",
  });
  expect(rejectedStreamedFailure.message).toContain(
    "response exceeds the 1 byte maxResponseBytes limit",
  );
  expect(rejectedStreamedFailure.message).not.toContain("cancellation rejection");
  expect(rejectedStreamedCancellations).toBe(1);
});

test("transport rejects a declared response above the default 32 MiB limit without consuming it", async () => {
  let bodyPulls = 0;
  let bodyCancellations = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        bodyPulls += 1;
        controller.enqueue(new Uint8Array([111, 107]));
        controller.close();
      },
      cancel() {
        bodyCancellations += 1;
      },
    },
    { highWaterMark: 0 },
  );

  const failure = await captureXnewsError(
    fetchText("https://example.com/default-limit?token=credential-must-not-leak", {
      fetch: async () =>
        new Response(body, {
          headers: { "Content-Length": "33554433" },
        }),
    }),
  );

  expect(failure).toMatchObject({
    code: "network",
    url: "https://example.com/default-limit?token=%3Credacted%3E",
  });
  expect(failure.message).not.toContain("credential-must-not-leak");
  expect(bodyPulls).toBe(0);
  expect(bodyCancellations).toBe(1);
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

  const malformedUrls = [
    {
      value: "https://example.com:invalid/feed?token=malformed-query-secret",
      secret: "malformed-query-secret",
    },
    {
      value: "https://user:malformed-userinfo-secret@[not-an-ipv6-host]/feed",
      secret: "malformed-userinfo-secret",
    },
    {
      value: "https://exa\u0000mple.com/control-path-secret",
      secret: "control-path-secret",
    },
  ] as const;
  let malformedRequests = 0;
  for (const malformed of malformedUrls) {
    const malformedFailure = await captureXnewsError(
      fetchText(malformed.value, {
        fetch: async () => {
          malformedRequests += 1;
          return new Response("unexpected");
        },
      }),
    );
    expect(malformedFailure).toMatchObject({ code: "config", url: "<invalid-url>" });
    expect(malformedFailure.message).toContain("<invalid-url>");
    expect(malformedFailure.message).not.toContain(malformed.secret);
    expect(malformedFailure.url).not.toContain(malformed.secret);
  }
  expect(malformedRequests).toBe(0);

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
