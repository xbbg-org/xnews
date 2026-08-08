import { expect, test } from "bun:test";
import { fetchDataRelease } from "../src/data.js";
import { XnewsFetchError } from "../src/errors.js";
import { BROWSERISH_USER_AGENT } from "../src/http.js";
import {
  HMDA_AGGREGATION_DIMENSIONS,
  fetchHmdaAggregations,
  fetchHmdaCount,
  fetchHmdaFilers,
  fetchHmdaLoanRecords,
  fetchHmdaNationwideAggregations,
  fetchHmdaNationwideLoanRecords,
  fetchHmdaNationwidePipeLoanRecords,
  fetchHmdaPipeLoanRecords,
  hmdaAggregationsUrl,
  hmdaCountUrl,
  hmdaCsvUrl,
  hmdaDataSource,
  hmdaFilersUrl,
  hmdaNationwideAggregationsUrl,
  hmdaNationwideCsvUrl,
  hmdaNationwidePipeUrl,
  hmdaPipeUrl,
  parseHmdaAggregations,
  parseHmdaFilers,
  parseHmdaLoanCsv,
  parseHmdaLoanPipe,
} from "../src/sources/hmda.js";

const aggregationPayload = JSON.stringify({
  parameters: { state: "DC", actions_taken: "1,2" },
  aggregations: [
    { count: 365, sum: 2.10855e8, actions_taken: "2" },
    { count: 8616, sum: 6.10754e9, actions_taken: "1" },
  ],
  servedFrom: "cache",
});

const filerPayload = JSON.stringify({
  institutions: [
    {
      lei: "549300AG64NHILB7ZP05",
      name: "LOANDEPOT.COM, LLC",
      count: 114,
      period: 2023,
    },
    {
      lei: "QFROUN1UWUYU0DVIWD51",
      name: "Fifth Third Bank, National Association",
      count: 3,
      period: 2023,
    },
  ],
});

const loanHeader = [
  "activity_year",
  "lei",
  "derived_msa-md",
  "state_code",
  "county_code",
  "census_tract",
  "derived_loan_product_type",
  "derived_dwelling_category",
  "derived_ethnicity",
  "derived_race",
  "derived_sex",
  "action_taken",
  "purchaser_type",
  "loan_type",
  "loan_purpose",
  "lien_status",
  "loan_amount",
  "loan_to_value_ratio",
  "interest_rate",
  "rate_spread",
  "property_value",
  "construction_method",
  "occupancy_type",
  "total_units",
  "income",
  "debt_to_income_ratio",
  "applicant_age",
  "co-applicant_age",
].join(",");

const loanRow = [
  "2023",
  "549300AG64NHILB7ZP05",
  "47894",
  "DC",
  "11001",
  "11001001901",
  "FHA:First Lien",
  "Single Family (1-4 Units):Site-Built",
  "Ethnicity Not Available",
  "Race Not Available",
  "Female",
  "1",
  "2",
  "2",
  "4",
  "1",
  "155000.0",
  "21.583",
  "5.5",
  "0.263",
  "695000",
  "1",
  "1",
  "1",
  "52",
  "50%-60%",
  ">74",
  "35-44",
].join(",");

const loanCsv = `${loanHeader}\n${loanRow}\n`;
const loanPipe = loanCsv.replaceAll(",", "|");

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("builds encoded HMDA URLs with comma-separated multi-value parameters", () => {
  const query = {
    years: [2023, 2024] as const,
    states: ["DC", "MD"],
    leis: ["549300AG64NHILB7ZP05", "QFROUN1UWUYU0DVIWD51"],
    actions_taken: [1, 2] as const,
    races: ["Asian", "Free Form Text Only"] as const,
    total_units: [1, ">149"] as const,
    dwelling_categories: "Single Family (1-4 Units):Site-Built" as const,
    loan_products: "Conventional:First Lien" as const,
  };
  const href = hmdaAggregationsUrl(query);
  expect(href).toContain("states=DC%2CMD");
  expect(href).toContain("races=Asian%2CFree+Form+Text+Only");
  expect(href).toContain("dwelling_categories=Single+Family+%281-4+Units%29%3ASite-Built");
  const url = new URL(href);
  expect(url.pathname).toBe("/v2/data-browser-api/view/aggregations");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    years: "2023,2024",
    states: "DC,MD",
    leis: "549300AG64NHILB7ZP05,QFROUN1UWUYU0DVIWD51",
    actions_taken: "1,2",
    races: "Asian,Free Form Text Only",
    total_units: "1,>149",
    dwelling_categories: "Single Family (1-4 Units):Site-Built",
    loan_products: "Conventional:First Lien",
  });

  expect(new URL(hmdaCountUrl({ years: 2023, states: "DC" })).pathname).toEndWith("/view/count");
  expect(new URL(hmdaFilersUrl({ years: 2023, counties: "11001" })).pathname).toEndWith(
    "/view/filers",
  );
  expect(new URL(hmdaCsvUrl(query)).pathname).toEndWith("/view/csv");
  expect(new URL(hmdaPipeUrl(query)).pathname).toEndWith("/view/pipe");

  const nationwide = { years: 2025, actions_taken: 8 as const, total_units: ">149" as const };
  expect(new URL(hmdaNationwideAggregationsUrl(nationwide)).pathname).toEndWith(
    "/view/nationwide/aggregations",
  );
  expect(new URL(hmdaNationwideCsvUrl(nationwide)).pathname).toEndWith("/view/nationwide/csv");
  expect(new URL(hmdaNationwidePipeUrl(nationwide)).pathname).toEndWith("/view/nationwide/pipe");
  expect(HMDA_AGGREGATION_DIMENSIONS).toContain("ageapplicant");
  expect(HMDA_AGGREGATION_DIMENSIONS).toContain("loan_products");
});

test("rejects HMDA URL queries without a data year or with an unknown dimension", () => {
  const queryWithUnknownDimension = {
    years: 2023,
    states: "DC",
    action_taken: 1,
  };
  expect(() => hmdaCountUrl({ years: [] })).toThrow(RangeError);
  expect(() => hmdaAggregationsUrl({ years: [] })).toThrow(
    "HMDA queries require at least one data year",
  );
  expect(() => hmdaAggregationsUrl(queryWithUnknownDimension)).toThrow(
    "Unknown HMDA query parameter",
  );
});

test("parses aggregation buckets and preserves echoed dimensions", () => {
  const rows = parseHmdaAggregations(aggregationPayload);
  expect(rows).toEqual([
    { count: 365, sum: 210_855_000, dimensions: { actions_taken: "2" }, warnings: [] },
    { count: 8616, sum: 6_107_540_000, dimensions: { actions_taken: "1" }, warnings: [] },
  ]);
});

test("parses HMDA filers with typed counts and periods", () => {
  const filers = parseHmdaFilers(filerPayload);
  expect(filers[0]).toEqual({
    lei: "549300AG64NHILB7ZP05",
    name: "LOANDEPOT.COM, LLC",
    count: 114,
    period: 2023,
    warnings: [],
  });
  expect(filers[1]?.count).toBe(3);
});

test("parses modified-LAR CSV and pipe rows with typed fields and verbatim raw data", () => {
  for (const record of [parseHmdaLoanCsv(loanCsv)[0], parseHmdaLoanPipe(loanPipe)[0]]) {
    expect(record).toMatchObject({
      rowNumber: 1,
      activityYear: 2023,
      lei: "549300AG64NHILB7ZP05",
      derivedMsaMd: "47894",
      stateCode: "DC",
      countyCode: "11001",
      censusTract: "11001001901",
      actionTaken: 1,
      purchaserType: 2,
      loanType: 2,
      loanPurpose: 4,
      lienStatus: 1,
      loanAmount: 155000,
      loanToValueRatio: 21.583,
      interestRate: 5.5,
      rateSpread: 0.263,
      propertyValue: 695000,
      constructionMethod: 1,
      occupancyType: 1,
      totalUnits: "1",
      income: 52,
      debtToIncomeRatio: "50%-60%",
      applicantAge: ">74",
      coApplicantAge: "35-44",
      warnings: [],
    });
    expect(record?.raw["loan_amount"]).toBe("155000.0");
    expect(record?.raw["derived_dwelling_category"]).toBe("Single Family (1-4 Units):Site-Built");
  }
});

test("fails closed on wrong-root JSON, header-less rows, and truncated CSV", () => {
  const failures: readonly (() => unknown)[] = [
    () => parseHmdaAggregations(JSON.stringify({ institutions: [] })),
    () => parseHmdaFilers(JSON.stringify({ aggregations: [] })),
    () => parseHmdaLoanCsv(loanRow),
    () => parseHmdaLoanCsv(`${loanHeader}\n"2023,unterminated`),
  ];
  for (const parse of failures) {
    let caught: unknown;
    try {
      parse();
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof XnewsFetchError)) {
      throw new Error("expected malformed HMDA payload to throw XnewsFetchError", {
        cause: caught,
      });
    }
    expect(caught.code).toBe("network");
  }
});

test("keeps rows while warning on numeric coercion failures", () => {
  const aggregate = parseHmdaAggregations(
    JSON.stringify({ aggregations: [{ count: "many", sum: "6107540000", actions_taken: "1" }] }),
  )[0];
  expect(aggregate).toMatchObject({ sum: 6_107_540_000, dimensions: { actions_taken: "1" } });
  expect(aggregate).not.toHaveProperty("count");
  expect(aggregate?.warnings[0]).toContain('count "many"');

  const invalidLoan = `${loanHeader}\n${loanRow.replace("155000.0", "not-a-number")}\n`;
  const record = parseHmdaLoanCsv(invalidLoan)[0];
  expect(record?.lei).toBe("549300AG64NHILB7ZP05");
  expect(record).not.toHaveProperty("loanAmount");
  expect(record?.warnings[0]).toContain('loan_amount "not-a-number"');
  expect(record?.raw["loan_amount"]).toBe("not-a-number");
});

test("fetch wrappers use a browser-shaped default UA and honor caller overrides", async () => {
  const userAgents: string[] = [];
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    userAgents.push(new Headers(init?.headers).get("user-agent") ?? "");
    return new Response(JSON.stringify({ aggregations: [{ count: 17474, sum: 1.145839e10 }] }));
  };
  const count = await fetchHmdaCount({ years: 2023, states: "DC" }, { fetch });
  const custom = await fetchHmdaCount(
    { years: 2023, states: "DC" },
    { fetch, userAgent: "Research Client/1.0" },
  );
  expect(count?.count).toBe(17474);
  expect(custom?.sum).toBe(11_458_390_000);
  expect(userAgents).toEqual([BROWSERISH_USER_AGENT, "Research Client/1.0"]);
});

test("zero limits return empty HMDA results before transport I/O", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => {
    calls += 1;
    throw new Error("should not fetch");
  };
  const query = { years: 2023, states: "DC", actions_taken: 1 as const };
  const nationwide = { years: 2025, actions_taken: 8 as const };
  expect(await fetchHmdaCount({ years: 2023, states: "DC" }, { fetch, limit: 0 })).toBeUndefined();
  expect(await fetchHmdaAggregations(query, { fetch, limit: 0 })).toEqual([]);
  expect(await fetchHmdaFilers({ years: 2023, states: "DC" }, { fetch, limit: 0 })).toEqual([]);
  expect(await fetchHmdaLoanRecords(query, { fetch, limit: 0 })).toEqual([]);
  expect(await fetchHmdaPipeLoanRecords(query, { fetch, limit: 0 })).toEqual([]);
  expect(await fetchHmdaNationwideAggregations(nationwide, { fetch, limit: 0 })).toEqual([]);
  expect(await fetchHmdaNationwideLoanRecords(nationwide, { fetch, limit: 0 })).toEqual([]);
  expect(await fetchHmdaNationwidePipeLoanRecords(nationwide, { fetch, limit: 0 })).toEqual([]);
  expect(calls).toBe(0);
});

test("HMDA data source advances by probing the next data year with count", async () => {
  const fetchedUrls: string[] = [];
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const href = fetchInputUrl(input);
    fetchedUrls.push(href);
    const url = new URL(href);
    if (url.pathname.endsWith("/count")) {
      return new Response(JSON.stringify({ aggregations: [{ count: 16963, sum: 1.1006735e10 }] }));
    }
    return new Response(
      JSON.stringify({
        aggregations: [{ count: 8482, sum: 6.013e9, actions_taken: "1" }],
      }),
    );
  };
  const source = hmdaDataSource(2023, { states: "DC", actions_taken: 1, fetch });
  const result = await fetchDataRelease(source, { ifNewerThan: "2023-12-31" });
  expect(result).toMatchObject({
    provider: "hmda",
    status: "ok",
    release: { asOf: "2024-12-31", rows: [{ count: 8482 }] },
  });
  expect(fetchedUrls).toHaveLength(2);
  expect(new URL(fetchedUrls[0] ?? "").pathname).toEndWith("/view/count");
  expect(new URL(fetchedUrls[0] ?? "").searchParams.get("years")).toBe("2024");
  expect(new URL(fetchedUrls[1] ?? "").pathname).toEndWith("/view/aggregations");
});
