import { expect, test } from "bun:test";
import { fetchDataRelease } from "../src/data.js";
import { XnewsFetchError } from "../src/http.js";
import {
  fetchFfiec002Report,
  ffiec002DataSource,
  ffiec002InstitutionProfileUrl,
  ffiec002ReportCsvUrl,
  parseFfiec002Report,
} from "../src/sources/ffiec002.js";

const REPORT_PARAMS = { rssdId: 112819, reportingDate: "2026-06-30" } as const;

// Hand-trimmed from NPW's FFIEC002_112819_20260630.csv response.
const REPORT_CSV = [
  "ItemName,Description,Value",
  "Institution Name,,DEUTSCHE BK AG NY BR",
  "Street Address,,1 COLUMBUS CIRCLE",
  "City,,NEW YORK",
  "State,,NY",
  "Zip Code,,10019",
  "Head Office Name,,DEUTSCHE BANK AKTIENGESELLSCHAFT",
  "Head Office City,,FRANKFURT",
  "Head Office Country,,GERMANY",
  "ID_RSSD,Reporting entity identifier,112819",
  'RCFD1545,"Loans for purchasing or carrying securities, including margin loans",1469384',
  "RCFD2170,TOTAL ASSETS (BANK U.S.+FOREIGN OFC),179780866",
  "TEXT5598,1ST TEXT - OFF-BALANCE SHEET CONTINGENT LIABILITIES,Forward Starter Repos",
  "RCFD6724,AUDIT LEVEL INDICATOR (MARCH REPORT ONLY) (BANK U.S.+FOREIGN OFC),NA",
].join("\r\n");

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("builds the NPW institution-level FFIEC 002 URL", () => {
  const url = new URL(ffiec002ReportCsvUrl(REPORT_PARAMS));
  expect(url.origin).toBe("https://www.ffiec.gov");
  expect(url.pathname).toBe("/npw/FinancialReport/ReturnFinancialReportCSV");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    rpt: "FFIEC002",
    id: "112819",
    dt: "20260630",
  });
  expect(ffiec002InstitutionProfileUrl(112819)).toBe(
    "https://www.ffiec.gov/npw/Institution/Profile/112819",
  );
});

test("rejects invalid FFIEC 002 request parameters before transport", () => {
  for (const build of [
    () => ffiec002ReportCsvUrl({ rssdId: 0, reportingDate: "2026-06-30" }),
    () => ffiec002ReportCsvUrl({ rssdId: 112819, reportingDate: "2026-02-30" }),
    () => ffiec002ReportCsvUrl({ rssdId: 112819, reportingDate: "06/30/2026" }),
  ]) {
    let caught: unknown;
    try {
      build();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(XnewsFetchError);
    expect(caught).toMatchObject({ code: "config" });
  }
});

test("parses institution metadata and typed FFIEC 002 line items with raw rows", () => {
  const report = parseFfiec002Report(REPORT_CSV, {
    reportingDate: "2026-06-30",
    expectedRssdId: 112819,
  });

  expect(report.reportingDate).toBe("2026-06-30");
  expect(report.institution).toMatchObject({
    name: "DEUTSCHE BK AG NY BR",
    rssdId: 112819,
    streetAddress: "1 COLUMBUS CIRCLE",
    city: "NEW YORK",
    state: "NY",
    zipCode: "10019",
    headOfficeName: "DEUTSCHE BANK AKTIENGESELLSCHAFT",
    headOfficeCity: "FRANKFURT",
    headOfficeCountry: "GERMANY",
  });
  expect(report.lineItems).toHaveLength(4);
  expect(report.lineItems[0]).toMatchObject({
    reportingDate: "2026-06-30",
    rssdId: 112819,
    mdrm: "RCFD1545",
    valueType: "number",
    numericValue: 1469384,
    rawValue: "1469384",
    raw: {
      ItemName: "RCFD1545",
      Description: "Loans for purchasing or carrying securities, including margin loans",
      Value: "1469384",
    },
  });
  expect(report.lineItems[2]).toMatchObject({
    mdrm: "TEXT5598",
    valueType: "text",
    textValue: "Forward Starter Repos",
  });
});

test("fails closed on wrong-root and truncated FFIEC 002 CSV payloads", () => {
  expect(() =>
    parseFfiec002Report("Name,Value\r\nRCFD2170,1", { reportingDate: "2026-06-30" }),
  ).toThrow("FFIEC 002 CSV has an unexpected payload shape");
  expect(() =>
    parseFfiec002Report('ItemName,Description,Value\r\nRCFD2170,"truncated', {
      reportingDate: "2026-06-30",
    }),
  ).toThrow("CSV ends inside a quoted field");
});

test("warns instead of crashing when a numeric line-item value cannot be coerced", () => {
  const report = parseFfiec002Report(REPORT_CSV, { reportingDate: "2026-06-30" });
  const auditLevel = report.lineItems.find((row) => row.mdrm === "RCFD6724");
  expect(auditLevel).toMatchObject({
    valueType: "number",
    rawValue: "NA",
  });
  expect(auditLevel?.numericValue).toBeUndefined();
  expect(auditLevel?.warnings).toEqual(['RCFD6724 value "NA" is not a finite number']);
  expect(report.warnings).toContain('RCFD6724 value "NA" is not a finite number');
});

test("fetches through the injected transport and preserves a caller User-Agent", async () => {
  const fetchedUrls: string[] = [];
  const seenUserAgents: (string | null)[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetchedUrls.push(fetchInputUrl(input));
    seenUserAgents.push(new Headers(init?.headers).get("user-agent"));
    return new Response(REPORT_CSV, { headers: { "Content-Type": "application/csv" } });
  };

  const release = await fetchFfiec002Report(REPORT_PARAMS, {
    fetch,
    userAgent: "ffiec002-test-agent",
    limit: 2,
  });
  expect(release).toMatchObject({
    provider: "ffiec-002",
    dataset: "112819",
    asOf: "2026-06-30",
    institution: { rssdId: 112819 },
  });
  expect(release?.rows).toHaveLength(2);
  expect(fetchedUrls).toEqual([ffiec002ReportCsvUrl(REPORT_PARAMS)]);
  expect(seenUserAgents).toEqual(["ffiec002-test-agent"]);
});

test("limit zero avoids transport for direct and data-lane fetches", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => {
    calls += 1;
    throw new Error("should not fetch");
  };

  expect(await fetchFfiec002Report(REPORT_PARAMS, { fetch, limit: 0 })).toBeUndefined();
  const result = await fetchDataRelease(ffiec002DataSource(REPORT_PARAMS, { fetch, limit: 0 }));
  expect(result).toMatchObject({
    provider: "ffiec-002",
    dataset: "112819",
    status: "empty",
    requestUrls: [],
  });
  expect(calls).toBe(0);
});
