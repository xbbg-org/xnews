import { expect, test } from "bun:test";
import {
  fetchWikipediaCongressRecentChanges,
  parseCongressionalIpRanges,
  parseWikipediaCongressRecentChanges,
  WIKIPEDIA_CONGRESS_EDITS_RANGES_URL,
  WIKIPEDIA_RECENT_CHANGES_API_URL,
  wikipediaCongressRecentChangesSource,
  wikipediaCongressRecentChangesUrl,
} from "../src/index.js";
import { fetchInputUrl } from "./fixtures.js";

const rangesFixture = JSON.stringify({
  ranges: {
    "US House of Representatives": [["143.231.0.0", "143.231.255.255"]],
    "US Senate": [["156.33.0.0", "156.33.255.255"]],
  },
});

const changesFixture = JSON.stringify({
  batchcomplete: true,
  query: {
    recentchanges: [
      {
        type: "edit",
        rcid: 1001,
        pageid: 11,
        revid: 501,
        old_revid: 500,
        title: "Unrelated article",
        userid: 0,
        anon: true,
        timestamp: "2026-08-21T00:30:00Z",
        user: "156.33.241.10",
        comment: "copy edit",
        oldlen: 100,
        newlen: 105,
        tags: [],
      },
      {
        type: "edit",
        rcid: 1002,
        pageid: 12,
        revid: 601,
        old_revid: 600,
        title: "United States Senate",
        timestamp: "2026-08-21T00:20:00Z",
        userid: 55_321_692,
        temp: true,
        user: "~2026-12345-6",
        comment: "updated leadership section",
        oldlen: 200,
        newlen: 180,
        minor: true,
        tags: ["visualeditor"],
      },
      {
        type: "new",
        rcid: 1003,
        pageid: 13,
        revid: 701,
        old_revid: 0,
        title: "H.R. 1234",
        timestamp: "2026-08-21T00:10:00Z",
        user: "ExampleEditor",
        userid: 123,
        comment: "new federal bill article",
        oldlen: 0,
        newlen: 300,
        tags: [],
      },
      {
        type: "edit",
        rcid: 1004,
        pageid: 14,
        revid: 801,
        old_revid: 800,
        title: "Ordinary article",
        timestamp: "2026-08-21T00:05:00Z",
        user: "ExampleEditor",
        comment: "spelling",
        userid: 123,
        oldlen: 10,
        newlen: 11,
        tags: [],
      },
      {
        type: "edit",
        rcid: 1005,
        pageid: 15,
        revid: 901,
        old_revid: 900,
        title: "Bot edit from range",
        timestamp: "2026-08-21T00:01:00Z",
        user: "143.231.249.141",
        bot: true,
        userid: 0,
        anon: true,
        tags: [],
      },
      {
        type: "edit",
        rcid: 1006,
        pageid: 16,
        revid: 1001,
        old_revid: 1000,
        title: "United States Congress",
        timestamp: "2026-08-21T00:00:30Z",
        user: "156.33.241.10",
        userid: 777,
        comment: "registered username happens to look like an IP",
        tags: [],
      },
    ],
  },
});

test("recent-changes URL requests non-bot edits newest-first within the window", () => {
  const url = new URL(
    wikipediaCongressRecentChangesUrl({
      since: "2026-08-21T00:00:00Z",
      until: "2026-08-21T01:00:00Z",
      limit: 250,
    }),
  );

  expect(`${url.origin}${url.pathname}`).toBe(WIKIPEDIA_RECENT_CHANGES_API_URL);
  expect(url.searchParams.get("list")).toBe("recentchanges");
  expect(url.searchParams.get("rctype")).toBe("edit|new");
  expect(url.searchParams.get("rcshow")).toBe("!bot");
  expect(url.searchParams.get("rcdir")).toBe("older");
  expect(url.searchParams.get("rcstart")).toBe("2026-08-21T01:00:00.000Z");
  expect(url.searchParams.get("rcend")).toBe("2026-08-21T00:00:00.000Z");
  expect(url.searchParams.get("rclimit")).toBe("250");
});

test("nonempty pages with no recognizable change records fail closed", () => {
  expect(() =>
    parseWikipediaCongressRecentChanges(
      JSON.stringify({ query: { recentchanges: [{ renamed_id: 1 }] } }),
      parseCongressionalIpRanges(rangesFixture),
    ),
  ).toThrow("unexpected Wikipedia recent-changes response shape");
});

test("direct IP attribution stays separate from topical relevance", () => {
  const rows = parseWikipediaCongressRecentChanges(
    changesFixture,
    parseCongressionalIpRanges(rangesFixture),
  );

  expect(rows).toHaveLength(4);
  expect(rows[0]).toMatchObject({
    recentChangeId: 1001,
    revisionId: 501,
    editorKind: "public-ip",
    attribution: {
      kind: "congress-network",
      chamber: "senate",
      congressionalNetwork: "US Senate",
      contributorIp: "156.33.241.10",
    },
    relevanceSignals: [],
    sizeDelta: 5,
  });
  expect(rows[0]?.diffUrl).toBe("https://en.wikipedia.org/w/index.php?diff=501&oldid=500");

  expect(rows[1]).toMatchObject({
    editor: "~2026-12345-6",
    editorKind: "temporary-account",
    attribution: { kind: "unattributed" },
    relevanceSignals: ["us-senate"],
    minor: true,
    sizeDelta: -20,
  });
  expect(rows[2]).toMatchObject({
    changeType: "new",
    editorKind: "registered",
    attribution: { kind: "unattributed" },
    relevanceSignals: ["federal-legislation"],
  });
  expect(rows.some((row) => row.revisionId === 801)).toBe(false);
  expect(rows.some((row) => row.revisionId === 901)).toBe(false);
  expect(rows[3]).toMatchObject({
    editor: "156.33.241.10",
    editorKind: "registered",
    attribution: { kind: "unattributed" },
    relevanceSignals: ["us-congress"],
  });
});

test("current fetcher reads both official changes and the archive range manifest", async () => {
  const requested: string[] = [];
  const rows = await fetchWikipediaCongressRecentChanges({
    since: "2026-08-21T00:00:00Z",
    until: "2026-08-21T01:00:00Z",
    fetch: async (input) => {
      const url = fetchInputUrl(input);
      requested.push(url);
      return new Response(
        url === WIKIPEDIA_CONGRESS_EDITS_RANGES_URL ? rangesFixture : changesFixture,
      );
    },
  });

  expect(rows).toHaveLength(4);
  expect(requested.some((url) => url.startsWith(WIKIPEDIA_RECENT_CHANGES_API_URL))).toBe(true);
  expect(requested).toContain(WIKIPEDIA_CONGRESS_EDITS_RANGES_URL);
});

test("fetcher follows continuation before applying the classified-row limit", async () => {
  const firstPage = JSON.stringify({
    continue: { rccontinue: "20260821002000|1002", continue: "-||" },
    query: {
      recentchanges: [
        {
          type: "edit",
          rcid: 2001,
          pageid: 21,
          revid: 2001,
          old_revid: 2000,
          userid: 10,
          title: "Unrelated page",
          timestamp: "2026-08-21T00:30:00Z",
          user: "OrdinaryEditor",
          comment: "copy edit",
          tags: [],
        },
      ],
    },
  });
  const secondPage = JSON.stringify({
    query: {
      recentchanges: [
        {
          type: "edit",
          rcid: 2002,
          pageid: 22,
          revid: 2002,
          old_revid: 2001,
          userid: 55_321_692,
          temp: true,
          title: "United States House of Representatives",
          timestamp: "2026-08-21T00:20:00Z",
          user: "~2026-12345-6",
          comment: "updated membership",
          tags: [],
        },
      ],
    },
  });
  const actionUrls: string[] = [];
  const rows = await fetchWikipediaCongressRecentChanges({
    since: "2026-08-21T00:00:00Z",
    until: "2026-08-21T01:00:00Z",
    upstreamLimit: 1,
    limit: 1,
    fetch: async (input) => {
      const url = fetchInputUrl(input);
      if (url === WIKIPEDIA_CONGRESS_EDITS_RANGES_URL) return new Response(rangesFixture);
      actionUrls.push(url);
      return new Response(new URL(url).searchParams.has("rccontinue") ? secondPage : firstPage);
    },
  });

  expect(actionUrls).toHaveLength(2);
  expect(new URL(actionUrls[1] ?? "").searchParams.get("rccontinue")).toBe("20260821002000|1002");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.revisionId).toBe(2002);
  expect(rows[0]?.attribution).toEqual({ kind: "unattributed" });
});

test("event source generates stable direct-IP and relevance alerts", async () => {
  const source = wikipediaCongressRecentChangesSource({
    since: "2026-08-21T00:00:00Z",
    until: "2026-08-21T01:00:00Z",
    fetch: async (input) =>
      new Response(
        fetchInputUrl(input) === WIKIPEDIA_CONGRESS_EDITS_RANGES_URL
          ? rangesFixture
          : changesFixture,
      ),
  });
  const snapshot = await source.fetchSnapshot();
  if (snapshot === undefined) throw new Error("expected recent Congress changes snapshot");

  expect(snapshot.events).toHaveLength(4);
  expect(snapshot.events[0]).toMatchObject({
    id: "wikipedia-revision-501",
    provider: "wikipedia-congress-edits",
    eventType: "direct-ip",
    areaName: "US Senate",
  });
  expect(snapshot.events[1]).toMatchObject({
    id: "wikipedia-revision-601",
    eventType: "congress-relevant",
  });
  expect(snapshot.events[1]?.summary).toContain("origin is not attributed");
});

test("event source resolves undefined for zero limits and valid no-match pages", async () => {
  let dialed = false;
  const zero = wikipediaCongressRecentChangesSource({
    limit: 0,
    fetch: async () => {
      dialed = true;
      return new Response("{}");
    },
  });
  expect(await zero.fetchSnapshot()).toBeUndefined();
  expect(zero.requestUrls()).toEqual([]);
  expect(dialed).toBe(false);

  const noMatchPage = JSON.stringify({
    query: {
      recentchanges: [
        {
          type: "edit",
          rcid: 3001,
          pageid: 31,
          revid: 3001,
          old_revid: 3000,
          userid: 10,
          title: "Ordinary page",
          timestamp: "2026-08-21T00:30:00Z",
          user: "OrdinaryEditor",
          comment: "copy edit",
          tags: [],
        },
      ],
    },
  });
  const empty = wikipediaCongressRecentChangesSource({
    since: "2026-08-21T00:00:00Z",
    until: "2026-08-21T01:00:00Z",
    fetch: async (input) =>
      new Response(
        fetchInputUrl(input) === WIKIPEDIA_CONGRESS_EDITS_RANGES_URL ? rangesFixture : noMatchPage,
      ),
  });
  expect(await empty.fetchSnapshot()).toBeUndefined();
});
