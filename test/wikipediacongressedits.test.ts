import { expect, test } from "bun:test";
import {
  fetchDataRelease,
  parseCongressionalIpRanges,
  parseWikipediaCongressEdits,
  WIKIPEDIA_CONGRESS_EDITS_COVERAGE_END,
  WIKIPEDIA_CONGRESS_EDITS_DATA_URL,
  WIKIPEDIA_CONGRESS_EDITS_RANGES_URL,
  wikipediaCongressEditsDataSource,
} from "../src/index.js";
import { fetchInputUrl } from "./fixtures.js";

const rangesFixture = JSON.stringify({
  ranges: {
    "US House of Representatives": [
      ["143.231.0.0", "143.231.255.255"],
      ["137.18.0.0", "137.18.255.255"],
    ],
    "US Senate": [["156.33.0.0", "156.33.255.255"]],
  },
});

const csvFixture = `page_id,title,diff_url,revision_id,timestamp,contributor_ip,contributor_ip_int
166103,David Hasselhoff,http://en.wikipedia.org/w/index.php?diff=615944864,615944864,1404738601,156.33.241.10,2619470090
4368634,Taiwanese people,http://en.wikipedia.org/w/index.php?diff=615432775,615432775,1404395506,143.231.249.141,2414344589
124796,"Weare, New Hampshire",http://en.wikipedia.org/w/index.php?diff=615318648,615318648,1404320587,137.18.255.41,2299723561
`;

test("Congress range manifest retains all ranges and labels House versus Senate", () => {
  expect(parseCongressionalIpRanges(rangesFixture)).toEqual([
    {
      chamber: "house",
      label: "US House of Representatives",
      startAddress: "143.231.0.0",
      endAddress: "143.231.255.255",
      start: 2_414_280_704,
      end: 2_414_346_239,
    },
    {
      chamber: "house",
      label: "US House of Representatives",
      startAddress: "137.18.0.0",
      endAddress: "137.18.255.255",
      start: 2_299_658_240,
      end: 2_299_723_775,
    },
    {
      chamber: "senate",
      label: "US Senate",
      startAddress: "156.33.0.0",
      endAddress: "156.33.255.255",
      start: 2_619_408_384,
      end: 2_619_473_919,
    },
  ]);
});

test("Congress edits preserve revision identity and classify the archive IP ranges", () => {
  const rows = parseWikipediaCongressEdits(csvFixture, parseCongressionalIpRanges(rangesFixture));

  expect(rows).toHaveLength(3);
  expect(rows[0]).toEqual({
    pageId: 166_103,
    title: "David Hasselhoff",
    diffUrl: "https://en.wikipedia.org/w/index.php?diff=615944864",
    revisionId: 615_944_864,
    timestamp: "2014-07-07T13:10:01.000Z",
    contributorIp: "156.33.241.10",
    contributorIpInt: 2_619_470_090,
    chamber: "senate",
    congressionalNetwork: "US Senate",
  });
  expect(rows[1]?.chamber).toBe("house");
  expect(rows[2]?.title).toBe("Weare, New Hampshire");
});

test("Congress edit filters apply before limit", () => {
  const rows = parseWikipediaCongressEdits(csvFixture, parseCongressionalIpRanges(rangesFixture), {
    chambers: ["house"],
    limit: 1,
  });

  expect(rows).toHaveLength(1);
  expect(rows[0]?.revisionId).toBe(615_432_775);
  expect(rows[0]?.chamber).toBe("house");
});

test("Congress edit date-window instants are inclusive", () => {
  const rows = parseWikipediaCongressEdits(csvFixture, parseCongressionalIpRanges(rangesFixture), {
    since: "2014-07-03T00:00:00.000Z",
    until: "2014-07-03T23:59:59.999Z",
  });

  expect(rows.map((row) => row.revisionId)).toEqual([615_432_775]);
});

test("Congress edits reject a published integer that disagrees with the IP", () => {
  expect(() =>
    parseWikipediaCongressEdits(
      csvFixture.replace("2414344589", "2414344588"),
      parseCongressionalIpRanges(rangesFixture),
    ),
  ).toThrow("unexpected Wikipedia Congress edits archive shape");
});

test("Congress edits data source fetches CSV and manifest and dates the filtered release", async () => {
  const requested: string[] = [];
  const result = await fetchDataRelease(wikipediaCongressEditsDataSource({ chambers: ["house"] }), {
    fetch: async (input) => {
      const url = fetchInputUrl(input);
      requested.push(url);
      return new Response(url === WIKIPEDIA_CONGRESS_EDITS_DATA_URL ? csvFixture : rangesFixture);
    },
  });

  expect(requested.toSorted()).toEqual(
    [WIKIPEDIA_CONGRESS_EDITS_DATA_URL, WIKIPEDIA_CONGRESS_EDITS_RANGES_URL].toSorted(),
  );
  expect(result.status).toBe("ok");
  expect(result.release?.provider).toBe("wikipedia-congress-edits");
  expect(result.release?.dataset).toBe("historical-edits");
  expect(result.release?.asOf).toBe("2014-07-03");
  expect(result.release?.rows).toHaveLength(2);
});

test("known archive coverage lets ifNewerThan skip both downloads", async () => {
  let dialed = false;
  const source = wikipediaCongressEditsDataSource();
  const release = await source.fetchRelease({
    ifNewerThan: WIKIPEDIA_CONGRESS_EDITS_COVERAGE_END,
    fetch: async () => {
      dialed = true;
      return new Response("");
    },
  });

  expect(release).toBeUndefined();
  expect(source.requestUrls({ ifNewerThan: WIKIPEDIA_CONGRESS_EDITS_COVERAGE_END })).toEqual([]);
  expect(dialed).toBe(false);
});
