import { expect, test } from "bun:test";
import {
  downloadFry9Archive,
  fetchFry9Data,
  FRY9_ARCHIVE_MAX_BYTES,
  FRY9_REPORTS,
  fry9ArchiveName,
  fry9ArchiveUrl,
  fry9FinancialDataPageUrl,
  fry9PeriodReports,
  fry9ReportDefinition,
  parseFry9Archive,
  parseFry9Page,
  parseFry9Text,
} from "../src/index.js";
import type { SourceFetch } from "../src/types.js";

const PERIOD = "2025-12-31";
const ARCHIVE_NAME = "BHCF20251231.ZIP";
const ENTRY_NAME = "BHCF20251231.txt";

function pageHtml(periods: readonly string[] = ["20251231", "20250930", "20250630"]): string {
  const buttons = periods
    .map(
      (period) => `<button onclick="ReturnBHCFZipFiles('BHCF${period}.ZIP')">
        <span class="link-text-align-svg">BHCF${period}.ZIP</span>
      </button>`,
    )
    .join("\n");
  return `<!doctype html><html><body>
    <h1>Financial Data Download</h1>
    <p>Holding Company Financial Data</p>
    <p>Each quarterly file contains all variables reported at the time of the respective financial statements.
      Please note that data is made available as received from reporting institutions and may not be all
      inclusive from all filers or subject to change prior to the 45-calendar day deadline for Y-9 reporting.</p>
    <ul>
      <li>Each quarterly file is downloadable as a compressed TXT file based on the selected financial year, then quarter.</li>
      <li>When files are unzipped, the data will be in text files delimited by the caret symbol (^), because some values contain commas.</li>
      <li>Data is refreshed daily around 5:00am (EST), Monday through Friday.</li>
      <li>Financial data are available for:
        <ul>
          <li>FR Y-9C — all domestic holding companies on a consolidated basis;</li>
          <li>FR Y-9LP — all large domestic holding companies on an unconsolidated parent only basis;</li>
          <li>FR Y-9SP — all small domestic holding companies on an unconsolidated parent basis, including balance sheet and income information for all three categories.</li>
        </ul>
      </li>
      <li>Financial and some structure items for all three reports are contained in one row for each institution within each file for the quarter selected. Files are not available by report.</li>
      <li>FR Y-9C and FR Y-9LP data are collected quarterly. FR Y-9SP is collected semiannually.</li>
    </ul>
    <select id="DropDownlistYears">
      <option> -- Select -- </option><option> 2026 </option><option> 2025 </option><option> 2024 </option>
    </select>
    <div id="divFiles">${buttons}</div>
    <script>
      function ReturnBHCFZipFiles(filename) {
        window.location.href = '../FinancialReport/ReturnBHCFZipFiles' + '?zipfilename=' + filename;
      }
    </script>
  </body></html>`;
}

const REAL_TEXT = [
  "RSSD9001^RSSD9999^BHCK2170^BHCP2170^BHSP0010^RSSD9017^TEXTC703",
  "1020201^20251231^^36939875^^HSBC USA INC.^",
  "1020395^20251231^^^0^SOUTHERN NATIONAL CORPORATION^Mauldin and Jenkins",
  "1020902^20251231^34923474^4712767^^FIRST NATIONAL OF NEBRASKA, INC.^Deloitte and Touche, LLP",
].join("\r\n");

function buildStoredZip(name: string, text: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const data = new TextEncoder().encode(text);
  const crc = Bun.hash.crc32(data);
  const local = new Uint8Array(30 + nameBytes.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint32(14, crc, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, central.length, true);
  eocdView.setUint32(16, local.length + data.length, true);

  const archive = new Uint8Array(local.length + data.length + central.length + eocd.length);
  archive.set(local, 0);
  archive.set(data, local.length);
  archive.set(central, local.length + data.length);
  archive.set(eocd, local.length + data.length + central.length);
  return archive;
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error", { cause: error });
  }
  throw new Error("Expected a rejection");
}

test("FR Y-9 catalog and URL builders expose the three combined-file forms", () => {
  expect(FRY9_REPORTS.map((definition) => definition.report)).toEqual([
    "fry9c",
    "fry9lp",
    "fry9sp",
  ]);
  expect(fry9ReportDefinition("fry9c").basis).toBe("consolidated");
  expect(fry9ArchiveName("fry9lp", PERIOD)).toBe(ARCHIVE_NAME);
  expect(fry9ArchiveUrl("fry9c", PERIOD)).toBe(
    "https://www.ffiec.gov/npw/FinancialReport/ReturnBHCFZipFiles?zipfilename=BHCF20251231.ZIP",
  );
  expect(fry9FinancialDataPageUrl(2025)).toBe(
    "https://www.ffiec.gov/npw/FinancialReport/FinancialDataDownload?selectedyear=2025",
  );
  expect(fry9PeriodReports("2025-09-30")).toEqual(["fry9c", "fry9lp"]);
  expect(fry9PeriodReports(PERIOD)).toEqual(["fry9c", "fry9lp", "fry9sp"]);
  expect(() => fry9ReportDefinition("unknown")).toThrow(RangeError);
  expect(() => fry9ArchiveUrl("fry9sp", "2025-09-30")).toThrow(RangeError);
});

test("FR Y-9 page parser validates the report list, cadence, and selected periods", () => {
  const page = parseFry9Page(pageHtml());
  expect(page.reports).toHaveLength(3);
  expect(page.years).toEqual([2026, 2025, 2024]);
  expect(page.selectedYear).toBe(2025);
  expect(page.periods).toEqual([
    {
      periodEnd: "2025-12-31",
      archiveName: "BHCF20251231.ZIP",
      reports: ["fry9c", "fry9lp", "fry9sp"],
    },
    {
      periodEnd: "2025-09-30",
      archiveName: "BHCF20250930.ZIP",
      reports: ["fry9c", "fry9lp"],
    },
    {
      periodEnd: "2025-06-30",
      archiveName: "BHCF20250630.ZIP",
      reports: ["fry9c", "fry9lp", "fry9sp"],
    },
  ]);
  expect(page.delimiter).toBe("^");
  expect(page.filingDeadlineDays).toBe(45);
});

test("FR Y-9 page parser fails closed on markup drift", () => {
  const drifted = pageHtml().replace("ReturnBHCFZipFiles(filename)", "RenamedDownload(filename)");
  expect(() => parseFry9Page(drifted)).toThrow("unexpected structure");
});

test("FR Y-9 parser separates consolidated, parent-only, and small-company line items", () => {
  const consolidated = parseFry9Text(REAL_TEXT, "fry9c");
  expect(consolidated).toHaveLength(1);
  expect(consolidated[0]).toMatchObject({
    rssdId: 1020902,
    name: "FIRST NATIONAL OF NEBRASKA, INC.",
    report: "fry9c",
    periodEnd: PERIOD,
    values: { BHCK2170: "34923474", TEXTC703: "Deloitte and Touche, LLP" },
  });
  expect(consolidated[0]?.values["BHCP2170"]).toBeUndefined();
  expect(consolidated[0]?.raw).toBe(
    "1020902^20251231^34923474^4712767^^FIRST NATIONAL OF NEBRASKA, INC.^Deloitte and Touche, LLP",
  );

  const parent = parseFry9Text(REAL_TEXT, "fry9lp", {
    rssdIds: [1020201],
    lineItems: ["BHCP2170"],
  });
  expect(parent).toEqual([
    {
      rssdId: 1020201,
      name: "HSBC USA INC.",
      report: "fry9lp",
      periodEnd: PERIOD,
      values: { BHCP2170: "36939875" },
      warnings: [],
      raw: "1020201^20251231^^36939875^^HSBC USA INC.^",
    },
  ]);

  const small = parseFry9Text(REAL_TEXT, "fry9sp");
  expect(small).toHaveLength(1);
  expect(small[0]).toMatchObject({
    rssdId: 1020395,
    values: { BHSP0010: "0", TEXTC703: "Mauldin and Jenkins" },
  });
});

test("FR Y-9 parser preserves unquoted line breaks inside caret-delimited fields", () => {
  const multiline = REAL_TEXT.replace(
    "FIRST NATIONAL OF NEBRASKA, INC.",
    "FIRST NATIONAL OF\r\nNEBRASKA, INC.",
  );
  const row = parseFry9Text(multiline, "fry9c")[0];
  expect(row?.name).toBe("FIRST NATIONAL OF\r\nNEBRASKA, INC.");
  expect(row?.raw).toContain("FIRST NATIONAL OF\r\nNEBRASKA, INC.");
  expect(row?.values["BHCK2170"]).toBe("34923474");
});

test("FR Y-9 coercion warnings preserve the raw value and leave RSSD ID unset", () => {
  const malformed = REAL_TEXT.replace("1020902^20251231", "not-an-id^20251231");
  const row = parseFry9Text(malformed, "fry9c")[0];
  expect(row?.rssdId).toBeUndefined();
  expect(row?.warnings).toEqual(['RSSD9001 is not a positive safe integer: "not-an-id"']);
  expect(row?.raw.startsWith("not-an-id^20251231")).toBe(true);
});

test("FR Y-9 text and archive parsers fail closed on truncation", async () => {
  expect(() => parseFry9Text(`${REAL_TEXT}\r\n1^2`, "fry9c")).toThrow("truncated row");
  const failure = await captureError(
    parseFry9Archive(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "fry9c", PERIOD),
  );
  expect(failure.message).toContain("archive is malformed");
});

test("FR Y-9 archive parser validates the entry and reporting period", async () => {
  const archive = buildStoredZip(ENTRY_NAME, REAL_TEXT);
  const rows = await parseFry9Archive(archive, "fry9c", PERIOD, { limit: 1 });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.rssdId).toBe(1020902);

  const mismatchArchive = buildStoredZip("BHCF20250930.txt", REAL_TEXT);
  const mismatch = await captureError(parseFry9Archive(mismatchArchive, "fry9c", "2025-09-30"));
  expect(mismatch.message).toContain("reporting period mismatch");
});

test("FR Y-9 fetchers use injected GET transport, Referer, and the raised ceiling", async () => {
  const archive = buildStoredZip(ENTRY_NAME, REAL_TEXT);
  const calls: { url: string; method: string; referer: string | null }[] = [];
  const fetchStub: SourceFetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", referer: headers.get("Referer") });
    return Promise.resolve(
      new Response(archive.slice(), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename=${ARCHIVE_NAME}`,
        },
      }),
    );
  };
  const download = await downloadFry9Archive("fry9c", PERIOD, { fetch: fetchStub });
  expect(download.bytes).toHaveLength(archive.length);
  expect(FRY9_ARCHIVE_MAX_BYTES).toBeGreaterThan(32 * 1024 * 1024);
  expect(calls).toEqual([
    {
      url: fry9ArchiveUrl("fry9c", PERIOD),
      method: "GET",
      referer: fry9FinancialDataPageUrl(2025),
    },
  ]);
});

test("FR Y-9 data fetch checks availability and skips unchanged archives", async () => {
  const archive = buildStoredZip(ENTRY_NAME, REAL_TEXT);
  const calls: string[] = [];
  const fetchStub: SourceFetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return Promise.resolve(
      url.includes("FinancialDataDownload")
        ? new Response(pageHtml())
        : new Response(archive.slice(), { headers: { "content-type": "application/zip" } }),
    );
  };

  const release = await fetchFry9Data("fry9c", {
    fetch: fetchStub,
    period: PERIOD,
    rssdIds: [1020902],
    lineItems: ["BHCK2170"],
  });
  expect(release?.asOf).toBe(PERIOD);
  expect(release?.rows[0]).toMatchObject({
    rssdId: 1020902,
    values: { BHCK2170: "34923474" },
  });
  expect(calls).toEqual([fry9FinancialDataPageUrl(2025), fry9ArchiveUrl("fry9c", PERIOD)]);

  calls.length = 0;
  const skipped = await fetchFry9Data("fry9c", {
    fetch: fetchStub,
    period: PERIOD,
    ifNewerThan: PERIOD,
  });
  expect(skipped).toBeUndefined();
  expect(calls).toEqual([fry9FinancialDataPageUrl(2025)]);

  const unavailable = await captureError(
    fetchFry9Data("fry9c", {
      fetch: fetchStub,
      period: "2025-03-31",
    }),
  );
  expect(unavailable).toBeInstanceOf(RangeError);
});

test("FR Y-9 limit zero avoids every network request and parser allocation", async () => {
  let calls = 0;
  const fetchStub: SourceFetch = () => {
    calls += 1;
    return Promise.reject(new Error("unexpected request"));
  };
  expect(await fetchFry9Data("fry9c", { fetch: fetchStub, limit: 0 })).toBeUndefined();
  expect(calls).toBe(0);
  expect(parseFry9Text("not caret data", "fry9c", { limit: 0 })).toEqual([]);
});
