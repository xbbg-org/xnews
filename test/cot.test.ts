import { expect, test } from "bun:test";
import { COT_DATASETS, PROVIDER_POLICIES } from "../src/catalog.js";
import {
  buildTopicNewsFeedResult,
  cotDataSource,
  cotDatasetDefinition,
  cotDatasetPageUrl,
  cotMarketPreset,
  cotReleaseToNewsItems,
  cotReportUrl,
  createDataReleaseWatcher,
  fetchCotReport,
  fetchDataRelease,
  parseCotRows,
  resolveCotMarketCodes,
} from "../src/index.js";
import type { CotRow, DataRelease, DataReleaseWatcherOptions, DataSource } from "../src/index.js";
import { XnewsFetchError } from "../src/http.js";

// Column names and values below mirror live rows probed from
// publicreporting.cftc.gov, including CFTC's published column typos.
const tffFixture = JSON.stringify([
  {
    market_and_exchange_names: "3 YEAR ERIS SOFR SWAP - CHICAGO BOARD OF TRADE",
    report_date_as_yyyy_mm_dd: "2026-08-04T00:00:00.000",
    contract_market_name: "3 YEAR ERIS SOFR SWAP",
    cftc_contract_market_code: "344606",
    cftc_market_code: "CBT ",
    commodity_name: "2-7-YEAR INTEREST RATE SWAPS ERIS & MAC",
    commodity_group_name: "FINANCIAL INSTRUMENTS",
    open_interest_all: "71964",
    change_in_open_interest_all: "-18178",
    traders_tot_all: "27",
    dealer_positions_long_all: "12984",
    dealer_positions_short_all: "29011",
    dealer_positions_spread_all: "3994",
    change_in_dealer_long_all: "12849",
    change_in_dealer_short_all: "2849",
    change_in_dealer_spread_all: "-2849",
    asset_mgr_positions_long: "0",
    asset_mgr_positions_short: "20771",
    asset_mgr_positions_spread: "0",
    change_in_asset_mgr_long: "-20000",
    change_in_asset_mgr_short: "16232",
    change_in_asset_mgr_spread: "-20000",
    lev_money_positions_long: "44726",
    lev_money_positions_short: "2550",
    lev_money_positions_spread: "5750",
    change_in_lev_money_long: "25763",
    change_in_lev_money_short: "0",
    change_in_lev_money_spread: "-13941",
    other_rept_positions_long: "4500",
    other_rept_positions_short: "9872",
    other_rept_positions_spread: "0",
    change_in_other_rept_long: "0",
    change_in_other_rept_short: "-479",
    change_in_other_rept_spread: "0",
    tot_rept_positions_long_all: "71954",
    tot_rept_positions_short: "71948",
    change_in_tot_rept_long_all: "-18178",
    change_in_tot_rept_short: "-18188",
    nonrept_positions_long_all: "10",
    nonrept_positions_short_all: "16",
    change_in_nonrept_long_all: "0",
    change_in_nonrept_short_all: "10",
  },
  {
    // Synthetic second market; trader totals and some changes suppressed.
    market_and_exchange_names: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: "2026-08-04T00:00:00.000",
    contract_market_name: "E-MINI S&P 500",
    cftc_contract_market_code: "13874A",
    cftc_market_code: "CME",
    open_interest_all: "2000000",
    dealer_positions_long_all: "100000",
    dealer_positions_short_all: "350000",
    lev_money_positions_long: "300000",
    lev_money_positions_short: "341213",
    change_in_lev_money_long: "-9455",
    change_in_lev_money_short: "-1000",
    asset_mgr_positions_long: "900000",
    asset_mgr_positions_short: "300000",
    other_rept_positions_long: "50000",
    other_rept_positions_short: "40000",
    tot_rept_positions_long_all: "1350000",
    tot_rept_positions_short: "1031213",
    nonrept_positions_long_all: "650000",
    nonrept_positions_short_all: "968787",
  },
]);

const legacyFixture = JSON.stringify([
  {
    market_and_exchange_names: "GULF # 6 FUEL OIL CRACK - NEW YORK MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: "2026-08-04T00:00:00.000",
    contract_market_name: "GULF # 6 FUEL OIL CRACK",
    cftc_contract_market_code: "86565A",
    cftc_market_code: "NYME",
    commodity_name: "FUEL OIL/CRUDE OIL",
    commodity_group_name: "NATURAL RESOURCES",
    open_interest_all: "11257",
    change_in_open_interest_all: "0",
    traders_tot_all: "30",
    noncomm_positions_long_all: "1470",
    noncomm_positions_short_all: "1582",
    noncomm_postions_spread_all: "1675",
    change_in_noncomm_long_all: "-75",
    change_in_noncomm_short_all: "150",
    change_in_noncomm_spead_all: "-150",
    comm_positions_long_all: "8112",
    comm_positions_short_all: "8000",
    change_in_comm_long_all: "225",
    change_in_comm_short_all: "0",
    tot_rept_positions_long_all: "11257",
    tot_rept_positions_short: "11257",
    nonrept_positions_long_all: "0",
    nonrept_positions_short_all: "0",
  },
]);

const disaggregatedFixture = JSON.stringify([
  {
    market_and_exchange_names: "GULF # 6 FUEL OIL CRACK - NEW YORK MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: "2026-08-04T00:00:00.000",
    contract_market_name: "GULF # 6 FUEL OIL CRACK",
    cftc_contract_market_code: "86565A",
    cftc_market_code: "NYME",
    open_interest_all: "11257",
    prod_merc_positions_long: "5922",
    prod_merc_positions_short: "6725",
    change_in_prod_merc_long: "225",
    change_in_prod_merc_short: "0",
    swap_positions_long_all: "1050",
    swap__positions_short_all: "135",
    swap__positions_spread_all: "1140",
    m_money_positions_long_all: "1280",
    m_money_positions_short_all: "225",
    m_money_positions_spread: "225",
    change_in_m_money_long_all: "0",
    change_in_m_money_short_all: "150",
    change_in_m_money_spread: "-150",
    other_rept_positions_long: "190",
    other_rept_positions_short: "1357",
    other_rept_positions_spread: "1450",
    tot_rept_positions_long_all: "11257",
    tot_rept_positions_short: "11257",
    nonrept_positions_long_all: "0",
    nonrept_positions_short_all: "0",
  },
]);

const citFixture = JSON.stringify([
  {
    market_and_exchange_names: "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    report_date_as_yyyy_mm_dd: "2022-08-02T00:00:00.000",
    contract_market_name: "WHEAT-SRW",
    cftc_contract_market_code: "001602",
    cftc_market_code: "CBT",
    open_interest_all: "422808",
    change_open_interest_all: "18367",
    traders_tot_all: "325",
    NComm_Postions_Long_All_NoCIT: "33177",
    NComm_Postions_Short_All_NoCIT: "87652",
    NComm_Postions_Spread_All_NoCIT: "133604",
    change_noncomm_long_all_nocit: "5546",
    Change_NonComm_Short_All_NoCIT: "8682",
    Change_NonComm_Spead_All_NoCIT: "4529",
    comm_positions_long_all_nocit: "70106",
    Comm_Positions_Short_All_NoCIT: "125999",
    change_comm_long_all_nocit: "4243",
    change_comm_short_all_nocit: "243",
    cit_positions_long_all: "154271",
    cit_positions_short_all: "34877",
    change_cit_long_all: "4906",
    change_cit_short_all: "3853",
    tot_rept_positions_long_all: "391158",
    tot_rept_positions_short: "382132",
    change_tot_rept_long_all: "19224",
    change_tot_rept_short_all: "17307",
    nonrept_positions_long_all: "31650",
    nonrept_positions_short_all: "40676",
    change_nonrept_long_all: "-857",
    change_nonrept_short_all: "1060",
  },
]);

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

/** URLSearchParams encodes spaces as `+` and parens as percent escapes. */
function decodedQuery(url: string | undefined): string {
  return decodeURIComponent((url ?? "").replaceAll("+", " "));
}

test("parseCotRows maps TFF columns onto typed categories", () => {
  const rows = parseCotRows(tffFixture, "tff_futures_only");
  expect(rows).toHaveLength(2);

  const eris = rows[0]!;
  expect(eris.family).toBe("tff");
  if (eris.family !== "tff") throw new Error("unreachable");
  expect(eris.asOf).toBe("2026-08-04");
  expect(eris.marketName).toBe("3 YEAR ERIS SOFR SWAP");
  expect(eris.cftcMarketCode).toBe("CBT");
  expect(eris.openInterest).toBe(71964);
  expect(eris.openInterestChange).toBe(-18178);
  expect(eris.tradersTotal).toBe(27);
  expect(eris.dealers).toEqual({
    long: 12984,
    short: 29011,
    spreading: 3994,
    longChange: 12849,
    shortChange: 2849,
    spreadingChange: -2849,
  });
  expect(eris.leveragedFunds.long).toBe(44726);
  expect(eris.assetManagers.longChange).toBe(-20000);
  expect(eris.totalReportable.short).toBe(71948);
  expect(eris.nonReportable.shortChange).toBe(10);

  const es = rows[1]!;
  if (es.family !== "tff") throw new Error("unreachable");
  expect(es.tradersTotal).toBeUndefined();
  expect(es.openInterestChange).toBeUndefined();
  expect(es.dealers.longChange).toBeUndefined();
  expect(es.leveragedFunds.longChange).toBe(-9455);
});

test("parseCotRows tolerates CFTC's published legacy column typos", () => {
  const rows = parseCotRows(legacyFixture, "legacy_futures_only");
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  if (row.family !== "legacy") throw new Error("unreachable");
  // noncomm_postions_spread_all / change_in_noncomm_spead_all, verbatim.
  expect(row.nonCommercial.spreading).toBe(1675);
  expect(row.nonCommercial.spreadingChange).toBe(-150);
  expect(row.nonCommercial.longChange).toBe(-75);
  expect(row.commercial).toEqual({
    long: 8112,
    short: 8000,
    longChange: 225,
    shortChange: 0,
  });
});

test("parseCotRows reads the disaggregated swap double-underscore columns", () => {
  const rows = parseCotRows(disaggregatedFixture, "disaggregated_futures_only");
  const row = rows[0]!;
  if (row.family !== "disaggregated") throw new Error("unreachable");
  expect(row.swapDealers).toEqual({ long: 1050, short: 135, spreading: 1140 });
  expect(row.managedMoney.spreading).toBe(225);
  expect(row.managedMoney.spreadingChange).toBe(-150);
  expect(row.producerMerchant.longChange).toBe(225);
});

test("parseCotRows reads the supplemental report's mixed-case columns", () => {
  const rows = parseCotRows(citFixture, "cit_supplemental");
  const row = rows[0]!;
  if (row.family !== "cit") throw new Error("unreachable");
  expect(row.asOf).toBe("2022-08-02");
  expect(row.openInterestChange).toBe(18367);
  expect(row.nonCommercialExIndex.spreading).toBe(133604);
  expect(row.nonCommercialExIndex.spreadingChange).toBe(4529);
  expect(row.commercialExIndex.short).toBe(125999);
  expect(row.indexTraders).toEqual({
    long: 154271,
    short: 34877,
    longChange: 4906,
    shortChange: 3853,
  });
  expect(row.totalReportable.longChange).toBe(19224);
  expect(row.nonReportable.longChange).toBe(-857);
});

test("parseCotRows requires canonical dates and explicitly present core numeric fields", () => {
  const shapeError = "unexpected CFTC Socrata response shape";
  const explicitZeroRecord = {
    market_and_exchange_names: "ZERO MARKET - TEST EXCHANGE",
    report_date_as_yyyy_mm_dd: "2026-08-04T00:00:00.000",
    cftc_contract_market_code: "000000",
    open_interest_all: 0,
    dealer_positions_long_all: 0,
    dealer_positions_short_all: 0,
    asset_mgr_positions_long: 0,
    asset_mgr_positions_short: 0,
    lev_money_positions_long: 0,
    lev_money_positions_short: 0,
    other_rept_positions_long: 0,
    other_rept_positions_short: 0,
    tot_rept_positions_long_all: 0,
    tot_rept_positions_short: 0,
    nonrept_positions_long_all: 0,
    nonrept_positions_short_all: 0,
  };

  const zeroRows = parseCotRows(JSON.stringify([explicitZeroRecord]), "tff_futures_only");
  expect(zeroRows).toHaveLength(1);
  const zeroRow = zeroRows[0]!;
  expect(zeroRow.openInterest).toBe(0);
  if (zeroRow.family !== "tff") throw new Error("unreachable");
  expect(zeroRow.dealers).toEqual({ long: 0, short: 0 });
  expect(zeroRow.nonReportable).toEqual({ long: 0, short: 0 });

  const identityOnlyRecord = {
    market_and_exchange_names: "IDENTITY ONLY - TEST EXCHANGE",
    report_date_as_yyyy_mm_dd: "2026-08-04T00:00:00.000",
    cftc_contract_market_code: "111111",
  };
  const invalidDateRecord = {
    ...explicitZeroRecord,
    report_date_as_yyyy_mm_dd: "2026-02-30T00:00:00.000",
  };
  const nonCanonicalDateRecord = {
    ...explicitZeroRecord,
    report_date_as_yyyy_mm_dd: "08/04/2026",
  };
  const missingCoreRecord: Record<string, unknown> = { ...explicitZeroRecord };
  delete missingCoreRecord["dealer_positions_short_all"];

  expect(() => parseCotRows(JSON.stringify([identityOnlyRecord]), "tff_futures_only")).toThrow(
    shapeError,
  );
  expect(() => parseCotRows(JSON.stringify([missingCoreRecord]), "tff_futures_only")).toThrow(
    shapeError,
  );
  expect(() => parseCotRows(JSON.stringify([invalidDateRecord]), "tff_futures_only")).toThrow(
    shapeError,
  );
  expect(() => parseCotRows(JSON.stringify([nonCanonicalDateRecord]), "tff_futures_only")).toThrow(
    shapeError,
  );

  const malformedRecords = JSON.stringify([identityOnlyRecord, invalidDateRecord]);
  const mixedRows = parseCotRows(
    tffFixture.replace("[", `${malformedRecords.slice(0, -1)},`),
    "tff_futures_only",
  );
  expect(mixedRows).toHaveLength(2);
  expect(mixedRows[0]?.cftcContractMarketCode).toBe("344606");
});

test("parseCotRows distinguishes empty and mixed arrays from invalid CFTC shapes", () => {
  const shapeError = "unexpected CFTC Socrata response shape";
  expect(parseCotRows("[]", "tff_futures_only")).toEqual([]);
  expect(parseCotRows(tffFixture, "tff_futures_only", 1)).toHaveLength(1);
  expect(parseCotRows(tffFixture, "tff_futures_only", 0)).toEqual([]);

  expect(() => parseCotRows(JSON.stringify([null, 42, "bad"]), "tff_futures_only")).toThrow(
    shapeError,
  );
  expect(() => parseCotRows(JSON.stringify([{}, { latest: 42 }]), "tff_futures_only")).toThrow(
    shapeError,
  );

  const mixedRows = parseCotRows(
    tffFixture.replace("[", '[null,{"missing":"required fields"},'),
    "tff_futures_only",
  );
  expect(mixedRows).toHaveLength(2);
  expect(mixedRows[0]?.cftcContractMarketCode).toBe("344606");

  expect(() => parseCotRows("<html>rate limited</html>", "tff_futures_only")).toThrow(
    /non-JSON CFTC Socrata response/,
  );
  const reflectedSecret = "$$app_token=reflected-secret";
  try {
    parseCotRows(JSON.stringify([{ unexpected: reflectedSecret }]), "tff_futures_only");
    throw new Error("expected response-shape validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("expected response-shape validation to throw an Error", { cause: error });
    }
    expect(error.message).toBe(shapeError);
    expect(error.message).not.toContain(reflectedSecret);
  }
});

test("cotReportUrl selects curated columns and filters by market and date", () => {
  const url = new URL(
    cotReportUrl("tff_futures_only", {
      markets: ["10y"],
      asOf: "2026-08-04",
      appToken: "token123",
    }),
  );
  expect(url.origin).toBe("https://publicreporting.cftc.gov");
  expect(url.pathname).toBe("/resource/gpe5-46if.json");
  const select = url.searchParams.get("$select") ?? "";
  expect(select).toContain("lev_money_positions_long");
  expect(select).toContain("report_date_as_yyyy_mm_dd");
  expect(url.searchParams.get("$where")).toBe(
    "cftc_contract_market_code in ('043602') AND report_date_as_yyyy_mm_dd = '2026-08-04'",
  );
  expect(url.searchParams.get("$order")).toBe(
    "report_date_as_yyyy_mm_dd DESC,cftc_contract_market_code",
  );
  expect(url.searchParams.get("$limit")).toBe("5000");
  expect(url.searchParams.get("$$app_token")).toBe("token123");

  const legacySelect =
    new URL(cotReportUrl("legacy_futures_only")).searchParams.get("$select") ?? "";
  expect(legacySelect).toContain("noncomm_postions_spread_all");
  expect(legacySelect).toContain("change_in_noncomm_spead_all");

  const boundedWhere = new URL(
    cotReportUrl("legacy_futures_only", {
      since: "2026-08-04T23:30:00-02:00",
      until: new Date("2026-08-06T23:59:59Z"),
    }),
  ).searchParams.get("$where");
  expect(boundedWhere).toBe(
    "report_date_as_yyyy_mm_dd >= '2026-08-05' AND report_date_as_yyyy_mm_dd <= '2026-08-06'",
  );
  expect(() => cotReportUrl("legacy_futures_only", { asOf: "2026-02-30" })).toThrow(
    "asOf must be a valid date or ISO date-time",
  );
  expect(() => cotReportUrl("legacy_futures_only", { since: new Date(Number.NaN) })).toThrow(
    "since must be a valid date or ISO date-time",
  );
  expect(() => cotReportUrl("legacy_futures_only", { until: "not a date" })).toThrow(
    "until must be a valid date or ISO date-time",
  );
});

test("market resolution accepts presets, aliases, raw codes, and rejects junk", () => {
  expect(resolveCotMarketCodes(["ES", "es"])).toEqual(["13874A"]);
  expect(resolveCotMarketCodes(["RTY"])).toEqual(["239742", "23977A"]);
  expect(resolveCotMarketCodes(["volatility"])).toEqual(["1170E1"]);
  expect(resolveCotMarketCodes(["86565a"])).toEqual(["86565A"]);
  expect(() => resolveCotMarketCodes(["not a market!"])).toThrow(/unknown COT market/);
  expect(cotMarketPreset("ty")?.symbol).toBe("ZN");
});

test("dataset resolution enforces the CIT combined-only constraint and limits", () => {
  expect(cotDatasetDefinition("tff").dataset).toBe("tff_futures_only");
  expect(cotDatasetDefinition("tff", { combined: true }).dataset).toBe("tff_combined");
  expect(cotDatasetDefinition("cit").dataset).toBe("cit_supplemental");
  expect(() => cotDatasetDefinition("cit", { combined: false })).toThrow(RangeError);
  expect(() => cotReportUrl("tff_futures_only", { limit: 50_001 })).toThrow(/at most 50000/);
  const socrataIds = new Set(COT_DATASETS.map((entry) => entry.socrataId));
  expect(socrataIds.size).toBe(COT_DATASETS.length);
});

test("fetchCotReport resolves the latest week with a probe, then pins it", async () => {
  const requested: string[] = [];
  const fetchStub = async (input: RequestInfo | URL): Promise<Response> => {
    const url = fetchInputUrl(input);
    requested.push(url);
    if (decodedQuery(url).includes("max(")) {
      return jsonResponse(JSON.stringify([{ latest: "2026-08-04T00:00:00.000" }]));
    }
    return jsonResponse(tffFixture);
  };

  const release = await fetchCotReport("tff", { fetch: fetchStub });
  expect(release).toBeDefined();
  expect(release?.provider).toBe("cftc-cot");
  expect(release?.dataset).toBe("tff_futures_only");
  expect(release?.asOf).toBe("2026-08-04");
  expect(release?.url).toBe(cotDatasetPageUrl("tff_futures_only"));
  expect(release?.rows).toHaveLength(2);
  expect(requested).toHaveLength(2);
  expect(decodedQuery(requested[0])).toContain("max(report_date_as_yyyy_mm_dd) AS latest");
  expect(decodedQuery(requested[1])).toContain("report_date_as_yyyy_mm_dd = '2026-08-04'");
});

test("fetchCotReport rejects a latest-date probe without a valid latest field", async () => {
  let calls = 0;
  const fetchStub = async (): Promise<Response> => {
    calls += 1;
    return jsonResponse(JSON.stringify([{ latest: "2026-02-30T00:00:00.000Z" }]));
  };

  let failure: unknown;
  try {
    await fetchCotReport("tff", { fetch: fetchStub });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toHaveProperty("message", "unexpected CFTC Socrata response shape");
  expect(calls).toBe(1);
});

test("fetchCotReport with a date window skips the probe and derives asOf", async () => {
  const requested: string[] = [];
  const fetchStub = async (input: RequestInfo | URL): Promise<Response> => {
    requested.push(fetchInputUrl(input));
    return jsonResponse(legacyFixture);
  };

  const release = await fetchCotReport("legacy", { fetch: fetchStub, since: "2026-07-01" });
  expect(requested).toHaveLength(1);
  expect(decodedQuery(requested[0])).toContain("report_date_as_yyyy_mm_dd >= '2026-07-01'");
  expect(release?.asOf).toBe("2026-08-04");
});

test("COT rejects invalid caller bounds before URL construction or I/O", async () => {
  let calls = 0;
  const countingFetch = async (): Promise<Response> => {
    calls += 1;
    return jsonResponse(tffFixture);
  };

  let directFailure: unknown;
  try {
    await fetchCotReport("tff", {
      fetch: countingFetch,
      limit: 0,
      since: "2026-02-30",
    });
  } catch (error) {
    directFailure = error;
  }
  expect(directFailure).toBeInstanceOf(RangeError);
  expect(directFailure).toHaveProperty("message", "since must be a valid date or ISO date-time");
  expect(calls).toBe(0);

  const wrapped = await fetchDataRelease(cotDataSource("tff", { until: "not a date" }), {
    fetch: countingFetch,
  });
  expect(wrapped.status).toBe("error");
  expect(wrapped.release).toBeUndefined();
  expect(wrapped.requestUrls).toEqual([]);
  expect(wrapped.error?.message).toBe("until must be a valid date or ISO date-time");
  expect(calls).toBe(0);
});

test("fetchCotReport resolves undefined without dialing when nothing is asked", async () => {
  let calls = 0;
  const countingFetch = async (): Promise<Response> => {
    calls += 1;
    return jsonResponse("[]");
  };
  expect(await fetchCotReport("tff", { fetch: countingFetch, limit: 0 })).toBeUndefined();
  expect(calls).toBe(0);

  // Empty probe: one dial, then undefined.
  expect(await fetchCotReport("tff", { fetch: countingFetch })).toBeUndefined();
  expect(calls).toBe(1);
});

test("fetchDataRelease wraps sources in the shared status taxonomy", async () => {
  const release: DataRelease<{ value: number }> = {
    provider: "cftc-cot",
    dataset: "tff_futures_only",
    asOf: "2026-08-04",
    url: "https://example.com",
    rows: [{ value: 1 }],
  };
  const okSource: DataSource<{ value: number }> = {
    provider: "cftc-cot",
    dataset: "tff_futures_only",
    requestUrls: () => ["https://example.com/a"],
    fetchRelease: async () => release,
  };
  const ok = await fetchDataRelease(okSource);
  expect(ok.status).toBe("ok");
  expect(ok.rowCount).toBe(1);
  expect(ok.release).toBe(release);
  expect(ok.requestUrls).toEqual(["https://example.com/a"]);

  const empty = await fetchDataRelease({ ...okSource, fetchRelease: async () => undefined });
  expect(empty.status).toBe("empty");
  expect(empty.release).toBeUndefined();
  expect(empty.rowCount).toBe(0);

  const zeroRowRelease: DataRelease<{ value: number }> = { ...release, rows: [] };
  const zeroRows = await fetchDataRelease({
    ...okSource,
    fetchRelease: async () => zeroRowRelease,
  });
  expect(zeroRows.status).toBe("ok");
  expect(zeroRows.release).toBe(zeroRowRelease);
  expect(zeroRows.rowCount).toBe(0);

  for (const malformedRelease of [
    { ...release, asOf: "not-a-date" },
    { ...release, asOf: "2026-02-30" },
    { ...release, sequence: Number.NaN },
    { ...release, sequence: 1.5 },
  ]) {
    const invalidRelease = await fetchDataRelease({
      ...okSource,
      fetchRelease: async () => malformedRelease,
    });
    expect(invalidRelease.status).toBe("error");
    expect(invalidRelease.error?.code).not.toBe("config");
    expect(invalidRelease.release).toBeUndefined();
  }

  for (const [contradictoryRelease, message] of [
    [
      { ...release, provider: "contradictory-provider" },
      "DataSource returned a release with an inconsistent provider",
    ],
    [
      { ...release, dataset: "contradictory-dataset" },
      "DataSource returned a release with an inconsistent dataset",
    ],
  ] as const) {
    const contradictory = await fetchDataRelease({
      ...okSource,
      fetchRelease: async () => contradictoryRelease,
    });
    expect(contradictory.status).toBe("error");
    expect(contradictory.provider).toBe(okSource.provider);
    expect(contradictory.dataset).toBe(okSource.dataset);
    expect(contradictory.release).toBeUndefined();
    expect(contradictory.error?.message).toBe(message);
  }

  const failing = await fetchDataRelease({
    ...okSource,
    fetchRelease: async () => {
      throw new XnewsFetchError("http_status", "GET https://example.com/a -> 429", {
        url: "https://example.com/a",
        status: 429,
      });
    },
  });
  expect(failing.status).toBe("error");
  expect(failing.error?.code).toBe("http_status");
  expect(failing.error?.status).toBe(429);
  expect(failing.warnings[0]).toContain("429");

  const disabled = await fetchDataRelease({
    ...okSource,
    fetchRelease: async () => {
      throw new XnewsFetchError("config", "app token required", { url: "https://example.com/a" });
    },
  });
  expect(disabled.status).toBe("disabled");
});

test("data release watcher yields new asOf values once and dedupes failures", async () => {
  const controller = new AbortController();
  const script: (DataRelease<{ n: number }> | Error | undefined)[] = [
    {
      provider: "p",
      dataset: "d",
      asOf: "2026-08-04",
      url: "https://example.com",
      rows: [{ n: 1 }],
    },
    {
      provider: "p",
      dataset: "d",
      asOf: "2026-08-04",
      url: "https://example.com",
      rows: [{ n: 1 }],
    },
    new Error("boom"),
    new Error("boom"),
    {
      provider: "p",
      dataset: "d",
      asOf: "2026-08-11",
      url: "https://example.com",
      rows: [{ n: 2 }],
    },
  ];
  let step = 0;
  const source: DataSource<{ n: number }> = {
    provider: "p",
    dataset: "d",
    requestUrls: () => [],
    fetchRelease: async () => {
      const next = script[Math.min(step, script.length - 1)];
      step += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };

  const seen: string[] = [];
  const watcher = createDataReleaseWatcher(source, {
    intervalMs: 1,
    signal: controller.signal,
  });
  for await (const result of watcher) {
    seen.push(result.status === "ok" ? `ok:${result.release?.asOf}` : result.status);
    if (seen.length === 3) controller.abort();
  }
  expect(seen).toEqual(["ok:2026-08-04", "error", "ok:2026-08-11"]);
  expect(step).toBeGreaterThanOrEqual(5);
});

test("data watcher yields and checkpoints a dated zero-row release", async () => {
  const controller = new AbortController();
  const source: DataSource<never> = {
    provider: "p",
    dataset: "d",
    requestUrls: () => [],
    fetchRelease: async () => ({
      provider: "p",
      dataset: "d",
      asOf: "2026-08-04",
      url: "https://example.com",
      rows: [],
    }),
  };

  const watcher = createDataReleaseWatcher(source, { signal: controller.signal });
  const first = await watcher.next();
  controller.abort();
  await watcher.next().catch(() => undefined);
  expect(first.done).toBe(false);
  expect(first.value?.status).toBe("ok");
  expect(first.value?.rowCount).toBe(0);
  expect(first.value?.release?.asOf).toBe("2026-08-04");
});

test("watcher honors sinceAsOf so restarts do not replay the last release", async () => {
  const controller = new AbortController();
  let polls = 0;
  const source: DataSource<{ n: number }> = {
    provider: "p",
    dataset: "d",
    requestUrls: () => [],
    fetchRelease: async () => {
      polls += 1;
      return {
        provider: "p",
        dataset: "d",
        // First poll re-serves the week the consumer already saw; the next
        // poll has a fresh week. The first yield must be the fresh one.
        asOf: polls === 1 ? "2026-08-04" : "2026-08-11",
        url: "https://example.com",
        rows: [{ n: polls }],
      };
    },
  };
  const watcher = createDataReleaseWatcher(source, {
    intervalMs: 1,
    signal: controller.signal,
    sinceAsOf: "2026-08-04",
  });
  const first = await watcher.next();
  controller.abort();
  await watcher.next().catch(() => undefined);
  expect(first.done).toBe(false);
  expect(first.done === false && first.value.release?.asOf).toBe("2026-08-11");
  expect(polls).toBe(2);
});

test("data watcher rejects malformed checkpoints as disabled without polling", async () => {
  let polls = 0;
  const source: DataSource<{ n: number }> = {
    provider: "p",
    dataset: "d",
    requestUrls: () => [],
    fetchRelease: async () => {
      polls += 1;
      return undefined;
    },
  };

  const malformedCheckpoints: DataReleaseWatcherOptions[] = [
    { sinceAsOf: "not-a-date" },
    { sinceAsOf: "2026-02-30" },
    { sinceSequence: Number.NaN },
    { sinceSequence: 1.5 },
  ];
  for (const checkpoint of malformedCheckpoints) {
    const watcher = createDataReleaseWatcher(source, checkpoint);
    const result = await watcher.next();
    expect(result.done).toBe(false);
    expect(result.value?.status).toBe("disabled");
    expect(result.value?.error?.code).toBe("config");
    expect((await watcher.next()).done).toBe(true);
  }
  expect(polls).toBe(0);
});

test("invalid source dates do not advance watcher checkpoints", async () => {
  const controller = new AbortController();
  const ifNewerThanValues: (string | undefined)[] = [];
  let polls = 0;
  const source: DataSource<{ n: number }> = {
    provider: "p",
    dataset: "d",
    requestUrls: () => [],
    fetchRelease: async (options) => {
      polls += 1;
      ifNewerThanValues.push(options?.ifNewerThan);
      return {
        provider: "p",
        dataset: "d",
        asOf: polls === 1 ? "2026-02-30" : "2026-03-01",
        url: "https://example.com",
        rows: [{ n: polls }],
      };
    },
  };
  const watcher = createDataReleaseWatcher(source, {
    intervalMs: 1,
    signal: controller.signal,
    sinceAsOf: "2026-02-28",
  });

  const invalid = await watcher.next();
  const valid = await watcher.next();
  controller.abort();
  await watcher.next().catch(() => undefined);

  expect(invalid.value?.status).toBe("error");
  expect(invalid.value?.error?.code).not.toBe("config");
  expect(valid.value?.status).toBe("ok");
  expect(valid.value?.release?.asOf).toBe("2026-03-01");
  expect(ifNewerThanValues).toEqual(["2026-02-28", "2026-02-28"]);
});

test("invalid source sequences do not advance watcher checkpoints", async () => {
  const controller = new AbortController();
  const afterSequences: (number | undefined)[] = [];
  let polls = 0;
  const source: DataSource<{ n: number }> = {
    provider: "p",
    dataset: "d",
    requestUrls: () => [],
    fetchRelease: async (options) => {
      polls += 1;
      afterSequences.push(options?.afterSequence);
      return {
        provider: "p",
        dataset: "d",
        asOf: "2026-08-04",
        sequence: polls === 1 ? 1.5 : 2,
        url: "https://example.com",
        rows: [{ n: polls }],
      };
    },
  };
  const watcher = createDataReleaseWatcher(source, {
    intervalMs: 1,
    signal: controller.signal,
    sinceSequence: 1,
  });

  const invalid = await watcher.next();
  const valid = await watcher.next();
  controller.abort();
  await watcher.next().catch(() => undefined);

  expect(invalid.value?.status).toBe("error");
  expect(invalid.value?.error?.code).not.toBe("config");
  expect(valid.value?.status).toBe("ok");
  expect(valid.value?.release?.sequence).toBe(2);
  expect(afterSequences).toEqual([1, 1]);
});

test("contradictory release identities do not advance watcher checkpoints", async () => {
  const controller = new AbortController();
  const ifNewerThanValues: (string | undefined)[] = [];
  const afterSequences: (number | undefined)[] = [];
  let polls = 0;
  const source: DataSource<{ n: number }> = {
    provider: "p",
    dataset: "d",
    requestUrls: () => [],
    fetchRelease: async (options) => {
      polls += 1;
      ifNewerThanValues.push(options?.ifNewerThan);
      afterSequences.push(options?.afterSequence);
      return {
        provider: polls === 1 ? "contradictory-provider" : "p",
        dataset: polls === 2 ? "contradictory-dataset" : "d",
        asOf: polls === 1 ? "2026-08-11" : polls === 2 ? "2026-08-18" : "2026-08-25",
        sequence: polls + 1,
        url: "https://example.com",
        rows: [{ n: polls }],
      };
    },
  };
  const watcher = createDataReleaseWatcher(source, {
    intervalMs: 1,
    signal: controller.signal,
    sinceAsOf: "2026-08-04",
    sinceSequence: 1,
  });

  const invalidProvider = await watcher.next();
  const invalidDataset = await watcher.next();
  const valid = await watcher.next();
  controller.abort();
  await watcher.next().catch(() => undefined);

  expect(invalidProvider.value?.status).toBe("error");
  expect(invalidProvider.value?.release).toBeUndefined();
  expect(invalidProvider.value?.error?.message).toBe(
    "DataSource returned a release with an inconsistent provider",
  );
  expect(invalidDataset.value?.status).toBe("error");
  expect(invalidDataset.value?.release).toBeUndefined();
  expect(invalidDataset.value?.error?.message).toBe(
    "DataSource returned a release with an inconsistent dataset",
  );
  expect(valid.value?.status).toBe("ok");
  expect(valid.value?.release?.provider).toBe(source.provider);
  expect(valid.value?.release?.dataset).toBe(source.dataset);
  expect(ifNewerThanValues).toEqual(["2026-08-04", "2026-08-04", "2026-08-04"]);
  expect(afterSequences).toEqual([1, 1, 1]);
});

test("cotReleaseToNewsItems renders one dated data item per market", () => {
  const rows = parseCotRows(tffFixture, "tff_futures_only");
  const release: DataRelease<CotRow> = {
    provider: "cftc-cot",
    dataset: "tff_futures_only",
    asOf: "2026-08-04",
    url: cotDatasetPageUrl("tff_futures_only"),
    rows,
  };

  const items = cotReleaseToNewsItems(release);
  expect(items).toHaveLength(2);

  const eris = items[0]!;
  expect(eris.provider).toBe("cftc-cot");
  expect(eris.kind).toBe("data");
  expect(eris.source).toBe("CFTC");
  expect(eris.title).toBe(
    "COT TFF: 3 YEAR ERIS SOFR SWAP - Leveraged funds net +42,176 (+25,763 w/w) - week ending 2026-08-04",
  );
  expect(eris.publishedAt).toBe("2026-08-04T00:00:00.000Z");
  expect(eris.reportDate).toBe("2026-08-04");
  expect(eris.id).toBe(`cftc-cot|tff_futures_only:344606:2026-08-04|${eris.title}`);
  expect(eris.summary).toContain("Open interest 71,964 (-18,178 w/w)");
  expect(eris.summary).toContain("Dealers net -16,027 (+10,000 w/w)");
  expect(eris.tags).toEqual(["cot", "tff", "tff_futures_only"]);

  const es = items[1]!;
  expect(es.title).toBe(
    "COT TFF: E-MINI S&P 500 - Leveraged funds net -41,213 (-8,455 w/w) - week ending 2026-08-04",
  );
  expect(es.tags).toContain("ES");

  const citItems = cotReleaseToNewsItems({
    provider: "cftc-cot",
    dataset: "cit_supplemental",
    asOf: "2022-08-02",
    url: cotDatasetPageUrl("cit_supplemental"),
    rows: parseCotRows(citFixture, "cit_supplemental"),
  });
  expect(citItems[0]?.title).toContain("Index traders net +119,394");
});

test("cftc-cot participates in feed plumbing only as an explicit no-op", async () => {
  expect(PROVIDER_POLICIES["cftc-cot"]?.notes).toContain("Socrata");
  const result = await buildTopicNewsFeedResult({
    query: "treasuries",
    sources: ["cftc-cot"],
    fetch: async () => {
      throw new Error("must not dial");
    },
  });
  expect(result.providers).toHaveLength(1);
  expect(result.providers[0]?.status).toBe("unsupported");
  expect(result.providers[0]?.warnings[0]).toContain("fetchCotReport");
});

test("cotDataSource binds options and reports request urls for observability", async () => {
  const requested: string[] = [];
  const fetchStub = async (input: RequestInfo | URL): Promise<Response> => {
    const url = fetchInputUrl(input);
    requested.push(url);
    if (decodedQuery(url).includes("max(")) {
      return jsonResponse(JSON.stringify([{ latest: "2026-08-04T00:00:00.000" }]));
    }
    return jsonResponse(tffFixture);
  };

  const source = cotDataSource("tff", { markets: ["ZN"] });
  expect(source.provider).toBe("cftc-cot");
  expect(source.dataset).toBe("tff_futures_only");
  const urls = source.requestUrls();
  expect(urls).toHaveLength(2);
  expect(decodedQuery(urls[0])).toContain("max(");
  expect(decodedQuery(urls[0])).toContain("'043602'");

  const result = await fetchDataRelease(source, { fetch: fetchStub });
  expect(result.status).toBe("ok");
  expect(result.rowCount).toBe(2);
  expect(requested.every((url) => decodeURIComponent(url).includes("'043602'"))).toBe(true);
});
