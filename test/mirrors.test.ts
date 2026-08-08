import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/errors.js";
import { resolveWorkIdentity } from "../src/works.js";
import type { WorkRecord, WorksSource } from "../src/types.js";
import {
  DEFAULT_MIRROR_POOL,
  loadMirrorList,
  mirrorBaseUrls,
  mirrorPool,
  parseMirrorList,
  resolveMirrorsFile,
  withMirrorFailover,
} from "../src/mirrors.js";

const LIST = `# leading comment
[libgen]
https://one.example        # fastest
two.example                # bare host
https://three.example/lg/  # path prefix, trailing slash

[Annas-Archive]
https://four.example
`;

test("parses pools, bare hosts, path prefixes, and labels", () => {
  const list = parseMirrorList(LIST, "test");

  expect(Object.keys(list.pools).toSorted()).toEqual(["annas-archive", "libgen"]);
  expect(mirrorBaseUrls(list, "libgen")).toEqual([
    "https://one.example",
    "https://two.example",
    "https://three.example/lg",
  ]);
  expect(mirrorPool(list, "libgen")[0]?.label).toBe("fastest");
  expect(list.warnings).toEqual([]);
});

test("pool lookup is case-insensitive on both sides", () => {
  const list = parseMirrorList(LIST, "test");

  expect(mirrorBaseUrls(list, "annas-archive")).toEqual(["https://four.example"]);
  expect(mirrorBaseUrls(list, "ANNAS-ARCHIVE")).toEqual(["https://four.example"]);
});

test("entries before any section land in the default pool", () => {
  const list = parseMirrorList("https://loose.example\n[named]\nhttps://named.example");

  expect(mirrorBaseUrls(list, DEFAULT_MIRROR_POOL)).toEqual(["https://loose.example"]);
  expect(mirrorBaseUrls(list, "named")).toEqual(["https://named.example"]);
});

test("a bad entry is dropped and explained, never fatal", () => {
  const list = parseMirrorList(
    [
      "[p]",
      "http://insecure.example",
      "not a url at all",
      "ftp://wrong.example",
      "https://good.example",
    ].join("\n"),
    "list.txt",
  );

  // http is refused at parse time because the fetch layer refuses it at request time.
  expect(mirrorBaseUrls(list, "p")).toEqual(["https://good.example"]);
  expect(list.warnings).toHaveLength(3);
  expect(list.warnings[0]).toContain("list.txt:2");
  expect(list.warnings.every((warning) => warning.includes("not a usable https origin"))).toBe(
    true,
  );
});

test("a duplicate origin in one pool is reported, not silently kept", () => {
  const list = parseMirrorList("[p]\nhttps://a.example\nhttps://a.example/");

  expect(mirrorBaseUrls(list, "p")).toEqual(["https://a.example"]);
  expect(list.warnings[0]).toContain("duplicate origin");
});

test("an absent pool reads as empty, not as an error", () => {
  expect(mirrorBaseUrls(parseMirrorList(""), "libgen")).toEqual([]);
});

test("the file path follows argument, then environment, then default", () => {
  expect(resolveMirrorsFile("explicit.txt")).toBe("explicit.txt");

  const previous = process.env["XNEWS_MIRRORS_FILE"];
  process.env["XNEWS_MIRRORS_FILE"] = "from-env.txt";
  try {
    expect(resolveMirrorsFile()).toBe("from-env.txt");
  } finally {
    if (previous === undefined) delete process.env["XNEWS_MIRRORS_FILE"];
    else process.env["XNEWS_MIRRORS_FILE"] = previous;
  }
});

async function captureXnewsError(promise: Promise<unknown>): Promise<XnewsFetchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof XnewsFetchError) return error;
    throw new Error("Expected XnewsFetchError", { cause: error });
  }
  throw new Error("Expected XnewsFetchError");
}

test("an unreadable list fails as config rather than reading as empty", async () => {
  const error = await captureXnewsError(loadMirrorList("does/not/exist.txt"));

  expect(error.code).toBe("config");
});

test("failover returns the first mirror that answers", async () => {
  const seen: string[] = [];
  const outcome = await withMirrorFailover(
    ["https://a.example", "https://b.example", "https://c.example"],
    (baseUrl) => {
      seen.push(baseUrl);
      if (baseUrl === "https://a.example") {
        return Promise.reject(
          new XnewsFetchError("network", "connection refused", { url: baseUrl }),
        );
      }
      return Promise.resolve(`answered by ${baseUrl}`);
    },
  );

  expect(outcome.value).toBe("answered by https://b.example");
  expect(outcome.baseUrl).toBe("https://b.example");
  expect(outcome.attempts).toHaveLength(1);
  expect(outcome.attempts[0]?.baseUrl).toBe("https://a.example");
  // c was never dialed.
  expect(seen).toEqual(["https://a.example", "https://b.example"]);
});

test("a local RangeError is rethrown unchanged without dialing another mirror", async () => {
  const seen: string[] = [];
  const failure = new RangeError("maxPages must be at least 1");

  const error = await withMirrorFailover(["https://a.example", "https://b.example"], (baseUrl) => {
    seen.push(baseUrl);
    return Promise.reject(failure);
  }).catch((cause: unknown) => cause);

  expect(error).toBe(failure);
  expect(seen).toEqual(["https://a.example"]);
});

test("a config error is rethrown unchanged without dialing another mirror", async () => {
  const seen: string[] = [];
  const failure = new XnewsFetchError("config", "layout changed", {
    url: "https://a.example",
  });

  const error = await withMirrorFailover(["https://a.example", "https://b.example"], (baseUrl) => {
    seen.push(baseUrl);
    return Promise.reject(failure);
  }).catch((cause: unknown) => cause);

  expect(error).toBe(failure);
  expect(seen).toEqual(["https://a.example"]);
});

for (const code of ["network", "http_status", "timeout"] as const) {
  test(`${code} errors advance to the next mirror`, async () => {
    const seen: string[] = [];
    const outcome = await withMirrorFailover(
      ["https://a.example", "https://b.example"],
      (baseUrl) => {
        seen.push(baseUrl);
        if (baseUrl === "https://a.example") {
          return Promise.reject(new XnewsFetchError(code, `${code} failure`, { url: baseUrl }));
        }
        return Promise.resolve(baseUrl);
      },
    );

    expect(outcome.value).toBe("https://b.example");
    expect(outcome.attempts).toEqual([
      {
        baseUrl: "https://a.example",
        code,
        message: `${code} failure`,
      },
    ]);
    expect(seen).toEqual(["https://a.example", "https://b.example"]);
  });
}

test("a successful empty answer ends the walk", async () => {
  const seen: string[] = [];
  const outcome = await withMirrorFailover(
    ["https://a.example", "https://b.example"],
    (baseUrl) => {
      seen.push(baseUrl);
      return Promise.resolve([]);
    },
  );

  expect(outcome.value).toEqual([]);
  expect(seen).toEqual(["https://a.example"]);
});

test("an exhausted pool names every mirror and exposes every cause", async () => {
  const failures = [
    new XnewsFetchError("http_status", "https://a.example said 503", {
      url: "https://a.example",
    }),
    new XnewsFetchError("http_status", "https://b.example said 503", {
      url: "https://b.example",
    }),
  ];
  let nextFailure = 0;
  const error = await captureXnewsError(
    withMirrorFailover(["https://a.example", "https://b.example"], () =>
      Promise.reject(failures[nextFailure++]),
    ),
  );

  expect(error.code).toBe("http_status");
  expect(error.message).toContain("a.example said 503");
  expect(error.message).toContain("b.example said 503");
  expect(error.cause).toBeInstanceOf(AggregateError);
  if (!(error.cause instanceof AggregateError)) {
    throw new Error("Expected mirror causes to be retained in an AggregateError");
  }
  expect(error.cause.errors).toEqual(failures);
});

test("an empty pool is a config error", async () => {
  const error = await captureXnewsError(withMirrorFailover([], () => Promise.resolve(1)));

  expect(error.code).toBe("config");
});

test("an abort stops the walk instead of burning the pool", async () => {
  const seen: string[] = [];
  const abort = new Error("aborted");
  abort.name = "AbortError";

  const error = await withMirrorFailover(["https://a.example", "https://b.example"], (baseUrl) => {
    seen.push(baseUrl);
    return Promise.reject(abort);
  }).catch((cause: unknown) => cause);

  expect(error).toBe(abort);
  expect(seen).toEqual(["https://a.example"]);
});

test("identity resolution surfaces an authoritative lookup failure without claiming no match", async () => {
  const record: WorkRecord = {
    provider: "test-records",
    sourceId: "record-1",
    title: "The Example Book",
    authors: ["A. Writer"],
    identity: { origin: "record", confidence: 1 },
    availability: "unknown",
    url: "https://records.example/record-1",
    warnings: [],
    provenance: [],
  };
  const source: WorksSource = {
    provider: "authority",
    requestUrls: () => ["https://authority.example/search"],
    search: () =>
      Promise.reject(
        new XnewsFetchError("config", "layout changed", {
          url: "https://authority.example/search",
        }),
      ),
  };

  const resolution = await resolveWorkIdentity(record, source);

  expect(resolution.status).toBe("disabled");
  expect(resolution.error).toMatchObject({ code: "config", message: "layout changed" });
  expect(resolution.candidates).toEqual([]);
  expect(resolution.warnings.some((warning) => warning.includes("no candidate matched"))).toBe(
    false,
  );
});
