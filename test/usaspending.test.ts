import { expect, test } from "bun:test";
import {
  parseUsaSpendingAwards,
  usaSpendingDataSource,
  usaSpendingDateWindow,
  usaSpendingSearchBody,
} from "../src/sources/usaspending.js";
import { requestBodyText } from "./fixtures.js";

const awardsPayload = JSON.stringify({
  results: [
    {
      "Award ID": "FA1234567890",
      "Recipient Name": "Acme Research, Inc.",
      "Award Amount": 1250000.5,
      "Awarding Agency": "Department of Energy",
      "Award Type": "Definitive Contract",
      "Start Date": "2026-01-05",
      "End Date": "2027-01-04",
      Description: "Advanced grid controls",
      generated_internal_id: "CONT_AWD_FA1234567890_8900",
    },
  ],
  page_metadata: { page: 1, hasNext: false },
});

test("builds the exact USAspending award-search POST body", () => {
  expect(
    usaSpendingSearchBody({
      since: "2026-01-01",
      until: "2026-01-31",
      page: 2,
      limit: 25,
    }),
  ).toEqual({
    filters: {
      award_type_codes: ["A", "B", "C", "D"],
      time_period: [{ start_date: "2026-01-01", end_date: "2026-01-31" }],
    },
    fields: [
      "Award ID",
      "Recipient Name",
      "Award Amount",
      "Awarding Agency",
      "Award Type",
      "Start Date",
      "End Date",
      "Description",
      "generated_internal_id",
    ],
    page: 2,
    limit: 25,
    sort: "Award Amount",
    order: "desc",
    subawards: false,
  });
});

test("defaults USAspending searches to a trailing 30-day window", () => {
  expect(usaSpendingDateWindow({}, new Date("2026-01-31T12:00:00Z"))).toEqual({
    startDate: "2026-01-02",
    endDate: "2026-01-31",
  });
});

test("maps human-named USAspending fields and builds the award URL", () => {
  expect(parseUsaSpendingAwards(awardsPayload)).toEqual([
    {
      awardId: "FA1234567890",
      recipientName: "Acme Research, Inc.",
      amount: 1250000.5,
      awardingAgency: "Department of Energy",
      awardType: "Definitive Contract",
      startDate: "2026-01-05",
      endDate: "2027-01-04",
      description: "Advanced grid controls",
      url: "https://www.usaspending.gov/award/CONT_AWD_FA1234567890_8900",
    },
  ]);
});

test("rejects a structurally unrecognizable USAspending results array", () => {
  expect(() =>
    parseUsaSpendingAwards(
      JSON.stringify({ results: [null], page_metadata: { page: 1, hasNext: false } }),
    ),
  ).toThrow("unexpected USAspending award search response shape");
});

test("publishes the requested window end as the USAspending release date", async () => {
  const source = usaSpendingDataSource();
  const release = await source.fetchRelease({
    since: "2026-01-01",
    until: "2026-01-31",
    fetch: async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(requestBodyText(init?.body))).toEqual(
        usaSpendingSearchBody({ since: "2026-01-01", until: "2026-01-31" }),
      );
      return new Response(awardsPayload);
    },
  });

  expect(source.requestUrls()).toEqual([
    "https://api.usaspending.gov/api/v2/search/spending_by_award/",
  ]);
  expect(release).toMatchObject({
    provider: "usaspending",
    dataset: "awards",
    asOf: "2026-01-31",
  });
  expect(release?.rows).toHaveLength(1);
});
