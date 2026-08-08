import { deflateRawSync } from "node:zlib";
import { expect, test } from "bun:test";
import {
  downloadFfiecBulkData,
  FFIEC_BULK_DOWNLOAD_FIELD,
  FFIEC_BULK_FORMAT_FIELD,
  FFIEC_BULK_PERIOD_FIELD,
  FFIEC_BULK_PRODUCT_FIELD,
  FFIEC_CDR_BULK_DATA_URL,
  fetchDataRelease,
  fetchFfiecCallReport,
  ffiecBulkDownloadForm,
  ffiecBulkFormatSelectForm,
  ffiecBulkProductSelectForm,
  ffiecCallDataSource,
  ffiecReleaseToNewsItems,
  ffiecReportingPeriodDate,
  ffiecReportingPeriodMatches,
  findFfiecReportingPeriod,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  parseFfiecBulkPage,
  parseFfiecCallBundle,
  parseFfiecFourPeriodBundle,
  parseFfiecTsvRows,
  parseFfiecUbprBundle,
  readZipEntries,
} from "../src/index.js";
import type { SourceFetch } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test-side ZIP writer (store or raw-deflate), enough for the reader.
// ---------------------------------------------------------------------------

interface ZipInput {
  readonly name: string;
  readonly text: string;
  readonly deflate?: boolean;
  /** Stamp 0xFFFFFFFF central sizes with a ZIP64 extra, as the CDR does. */
  readonly zip64?: boolean;
  /** Central-directory uncompressed size, when it should not match the data. */
  readonly declaredUncompressed?: number;
}

function buildZip(inputs: readonly ZipInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const input of inputs) {
    const nameBytes = encoder.encode(input.name);
    const data = encoder.encode(input.text);
    const method = input.deflate ? 8 : 0;
    const payload = input.deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const crc = Bun.hash.crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const zip64Extra = input.zip64 ? 20 : 0;
    const record = new Uint8Array(46 + nameBytes.length + zip64Extra);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true);
    recordView.setUint16(4, input.zip64 ? 45 : 20, true);
    recordView.setUint16(6, input.zip64 ? 45 : 20, true);
    recordView.setUint16(10, method, true);
    recordView.setUint32(16, crc, true);
    recordView.setUint32(20, input.zip64 ? 0xffffffff : payload.length, true);
    recordView.setUint32(
      24,
      input.zip64 ? 0xffffffff : (input.declaredUncompressed ?? data.length),
      true,
    );
    recordView.setUint16(28, nameBytes.length, true);
    recordView.setUint16(30, zip64Extra, true);
    recordView.setUint32(42, offset, true);
    record.set(nameBytes, 46);
    if (input.zip64) {
      const extraStart = 46 + nameBytes.length;
      recordView.setUint16(extraStart, 0x0001, true);
      recordView.setUint16(extraStart + 2, 16, true);
      recordView.setBigUint64(extraStart + 4, BigInt(data.length), true);
      recordView.setBigUint64(extraStart + 12, BigInt(payload.length), true);
    }

    chunks.push(local, payload);
    central.push(record);
    offset += local.length + payload.length;
  }

  const centralSize = central.reduce((size, record) => size + record.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, inputs.length, true);
  eocdView.setUint16(10, inputs.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const archive = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, eocd]) {
    archive.set(chunk, cursor);
    cursor += chunk.length;
  }
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function bulkPageHtml(viewstate: string, options: { periods?: boolean } = {}): string {
  const periods = options.periods
    ? `<option selected="selected" value="151">03/31/2026</option>
       <option value="150">12/31/2025</option>
       <option value="149">09/30/2025</option>`
    : "";
  return `<!DOCTYPE html><html><body>
  <form method="post" action="./downloadbulkdata.aspx" id="Form1">
  <input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="" />
  <input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value="" />
  <input type="hidden" name="__LASTFOCUS" id="__LASTFOCUS" value="" />
  <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${viewstate}" />
  <input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="651D9554" />
  <span>Call Updated: 7/15/2026</span><span>UBPR Updated: 6/30/2026</span>
  <select size="4" name="ctl00$MainContentHolder$ListBox1" id="ListBox1">
    <option selected="selected" value="ReportingSeriesSinglePeriod">Call Reports -- Single Period</option>
    <option value="PerformanceReportingSeriesFourPeriods">UBPR Ratio -- Four Periods</option>
  </select>
  <select name="ctl00$MainContentHolder$DatesDropDownList" id="DatesDropDownList">${periods}</select>
  </form></body></html>`;
}

const POR_TEXT = [
  "IDRSSD\tFDIC Certificate Number\tOCC Charter Number\tOTS Docket Number\tPrimary ABA Routing Number\tFinancial Institution Name\tFinancial Institution Address\tFinancial Institution City\tFinancial Institution State\tFinancial Institution Zip Code\tFinancial Institution Filing Type\tLast Date/Time Submission Updated On",
  "37\t3511\t1\t\t21000018\tBANK OF EXAMPLE\t1 MAIN ST\tNEW YORK\tNY\t10001\t041\t2026-05-07 14:33:27",
  '12345\t99999\t\t\t\t"QUOTED, BANK"\t2 ELM ST\tBOSTON\tMA\t02110\t051\t',
  "",
].join("\r\n");

const RC_PART_ONE = [
  "IDRSSD\tRCON2170\tRCON2200",
  "\tTOTAL ASSETS\tTOTAL DEPOSITS",
  "37\t1000\t800",
  "12345\t500\t",
].join("\r\n");

const RC_PART_TWO = [
  "IDRSSD\tRCON2170\tRCON3210",
  "\tTOTAL ASSETS\tTOTAL EQUITY CAPITAL",
  "37\t1000\t90",
  "12345\t500\t45",
].join("\r\n");

const RI_TEXT = ["IDRSSD\tRIAD4340", "\tNET INCOME", "37\t12"].join("\r\n");

function callBundleZip(): Uint8Array {
  return buildZip([
    { name: "Readme.txt", text: "FFIEC CDR call bulk readme" },
    { name: "FFIEC CDR Call Bulk POR 03312026.txt", text: POR_TEXT, deflate: true },
    { name: "FFIEC CDR Call Schedule RC 03312026(1 of 2).txt", text: RC_PART_ONE, deflate: true },
    { name: "FFIEC CDR Call Schedule RC 03312026(2 of 2).txt", text: RC_PART_TWO },
    { name: "FFIEC CDR Call Schedule RI 03312026.txt", text: RI_TEXT, deflate: true },
  ]);
}

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

test("zip reader extracts stored and deflated entries", async () => {
  const entries = await readZipEntries(callBundleZip(), "FFIEC bulk archive");
  expect(entries.map((entry) => entry.name)).toEqual([
    "Readme.txt",
    "FFIEC CDR Call Bulk POR 03312026.txt",
    "FFIEC CDR Call Schedule RC 03312026(1 of 2).txt",
    "FFIEC CDR Call Schedule RC 03312026(2 of 2).txt",
    "FFIEC CDR Call Schedule RI 03312026.txt",
  ]);
  expect(new TextDecoder().decode(entries[0]?.bytes)).toBe("FFIEC CDR call bulk readme");
  expect(new TextDecoder().decode(entries[1]?.bytes)).toBe(POR_TEXT);
});

test("zip reader resolves ZIP64 per-entry sizes as the CDR writer emits them", async () => {
  const entries = await readZipEntries(
    buildZip([
      { name: "FFIEC CDR Call Bulk POR 03312026.txt", text: POR_TEXT, deflate: true, zip64: true },
      { name: "Readme.txt", text: "zip64 readme", zip64: true },
    ]),
    "FFIEC bulk archive",
  );
  expect(new TextDecoder().decode(entries[0]?.bytes)).toBe(POR_TEXT);
  expect(new TextDecoder().decode(entries[1]?.bytes)).toBe("zip64 readme");
});

test("an entry whose declared size the stream contradicts is refused", async () => {
  const archive = buildZip([
    { name: "Readme.txt", text: "short readme", deflate: true, declaredUncompressed: 4096 },
  ]);

  const failure = await captureError(readZipEntries(archive, "FFIEC bulk archive"));

  expect(failure.message).toBe(
    'FFIEC bulk archive: entry "Readme.txt" declares 4096 bytes but inflated to 12',
  );
});

test("an entry declaring more than the archive budget never reaches the decompressor", async () => {
  const archive = buildZip([
    {
      name: "Readme.txt",
      text: "short readme",
      deflate: true,
      declaredUncompressed: MAX_ZIP_UNCOMPRESSED_BYTES + 1,
    },
  ]);

  const failure = await captureError(readZipEntries(archive, "FFIEC bulk archive"));

  expect(failure.message).toContain(
    `declares ${MAX_ZIP_UNCOMPRESSED_BYTES + 1} bytes, past this archive's remaining ${MAX_ZIP_UNCOMPRESSED_BYTES} byte decompression budget`,
  );
});

test("bulk page parser extracts hidden fields, selects, and update stamps", () => {
  const page = parseFfiecBulkPage(bulkPageHtml("VS1", { periods: true }));
  expect(page.hiddenFields["__VIEWSTATE"]).toBe("VS1");
  expect(page.hiddenFields["__VIEWSTATEGENERATOR"]).toBe("651D9554");
  expect(page.products.map((product) => product.formValue)).toEqual([
    "ReportingSeriesSinglePeriod",
    "PerformanceReportingSeriesFourPeriods",
  ]);
  expect(page.periods).toEqual([
    { formValue: "151", label: "03/31/2026" },
    { formValue: "150", label: "12/31/2025" },
    { formValue: "149", label: "09/30/2025" },
  ]);
  expect(page.callUpdated).toBe("2026-07-15");
  expect(page.ubprUpdated).toBe("2026-06-30");
});

test("reporting periods resolve by label, form value, yyyymmdd, and ISO date", () => {
  const period = { formValue: "151", label: "03/31/2026" };
  expect(ffiecReportingPeriodDate(period)).toBe("2026-03-31");
  for (const query of ["151", "03/31/2026", "3/31/2026", "20260331", "2026-03-31"]) {
    expect(ffiecReportingPeriodMatches(period, query)).toBe(true);
  }
  expect(ffiecReportingPeriodMatches(period, "12/31/2025")).toBe(false);

  const periods = [period, { formValue: "150", label: "12/31/2025" }];
  expect(findFfiecReportingPeriod("20251231", periods)?.formValue).toBe("150");
  expect(findFfiecReportingPeriod("06/30/1999", periods)).toBeUndefined();
});

test("postback form builders echo hidden fields and reject unsupported formats", () => {
  const hidden = { __VIEWSTATE: "VS", __VIEWSTATEGENERATOR: "GEN" };
  const productForm = ffiecBulkProductSelectForm(hidden, "call-single");
  expect(productForm["__EVENTTARGET"]).toBe(FFIEC_BULK_PRODUCT_FIELD);
  expect(productForm["__VIEWSTATE"]).toBe("VS");
  expect(productForm[FFIEC_BULK_PRODUCT_FIELD]).toBe("ReportingSeriesSinglePeriod");

  const downloadForm = ffiecBulkDownloadForm(hidden, "call-single", "151", "tsv");
  expect(downloadForm["__EVENTTARGET"]).toBe("");
  expect(downloadForm[FFIEC_BULK_DOWNLOAD_FIELD]).toBe("Download");
  expect(downloadForm[FFIEC_BULK_FORMAT_FIELD]).toBe("TSVRadioButton");

  expect(() => ffiecBulkFormatSelectForm(hidden, "ubpr-ratio-single", "151", "tsv")).toThrow(
    RangeError,
  );
  expect(() =>
    // @ts-expect-error -- exercises the runtime guard for untyped callers
    ffiecBulkProductSelectForm(hidden, "no-such-product"),
  ).toThrow(RangeError);
});

test("TSV rows honor quoted fields with embedded delimiters", () => {
  const rows = parseFfiecTsvRows('a\t"with\ttab"\t"double""quote"\r\nplain\t\t');
  expect(rows).toEqual([
    ["a", "with\ttab", 'double"quote'],
    ["plain", "", ""],
  ]);
});

test("call bundle parses POR roster and merges split schedules", async () => {
  const bundle = await parseFfiecCallBundle(callBundleZip());
  expect(bundle.periodEnd).toBe("2026-03-31");
  expect(bundle.readme).toBe("FFIEC CDR call bulk readme");

  expect(bundle.institutions).toHaveLength(2);
  expect(bundle.institutions[0]).toMatchObject({
    rssdId: 37,
    fdicCert: 3511,
    occCharter: 1,
    abaRouting: 21000018,
    name: "BANK OF EXAMPLE",
    state: "NY",
    filingType: "041",
    lastUpdated: "2026-05-07 14:33:27",
  });
  expect(bundle.institutions[0]?.otsDocket).toBeUndefined();
  expect(bundle.institutions[1]?.name).toBe("QUOTED, BANK");

  const rc = bundle.schedules.find((schedule) => schedule.code === "RC");
  expect(rc?.columns.map((column) => column.mdrm)).toEqual(["RCON2170", "RCON2200", "RCON3210"]);
  expect(rc?.columns[0]?.description).toBe("TOTAL ASSETS");
  const bank = rc?.facts.find((facts) => facts.rssdId === 37);
  expect(bank?.values).toEqual({ RCON2170: "1000", RCON2200: "800", RCON3210: "90" });
  const quoted = rc?.facts.find((facts) => facts.rssdId === 12345);
  expect(quoted?.values).toEqual({ RCON2170: "500", RCON3210: "45" });

  const ri = bundle.schedules.find((schedule) => schedule.code === "RI");
  expect(ri?.facts).toEqual([{ rssdId: 37, values: { RIAD4340: "12" } }]);
});

test("four-period bundle groups filings by filer and period end", async () => {
  const text = [
    "Reporting Period End Date\tIDRSSD\tFinancial Institution Name\tFinancial Institution State\tRCON2170",
    "\t\t\t\tTOTAL ASSETS",
    "2026-03-31\t37\tBANK OF EXAMPLE\tNY\t1000",
    "2025-12-31\t37\tBANK OF EXAMPLE\tNY\t990",
    "2026-03-31\t12345\tQUOTED BANK\tMA\t500",
  ].join("\n");
  const bundle = await parseFfiecFourPeriodBundle(
    buildZip([
      { name: "Readme.txt", text: "subset readme" },
      { name: "FFIEC CDR Call Subset of Schedules 2026(1 of 1).txt", text, deflate: true },
    ]),
  );

  expect(bundle.periodLabel).toBe("2026");
  expect(bundle.columns.map((column) => column.mdrm)).toEqual(["RCON2170"]);
  expect(bundle.filings).toHaveLength(3);
  const filer = bundle.filings.filter((filing) => filing.rssdId === 37);
  expect(filer.map((filing) => filing.periodEnd).toSorted()).toEqual(["2025-12-31", "2026-03-31"]);
  expect(filer[0]?.institution.name).toBe("BANK OF EXAMPLE");
});

test("UBPR bundle parses three header rows and period timestamps", async () => {
  const text = [
    "ID RSSD\tReporting Period\tPeer Group\tPeer Group Description\tUBPRE001\tUBPRE002",
    "\t\t\t\tUBPR:NetIncome\tUBPR:ROA",
    "\t\t\t\tNet income\tReturn on assets",
    "37\t3/31/2026 12:00:00 AM\t1\tBanks over $100B\t12\t1.05",
    "\t12/31/2025\t1\tBanks over $100B\t\t0.98",
  ].join("\n");
  const bundle = await parseFfiecUbprBundle(
    buildZip([
      { name: "FFIEC CDR UBPR Ratios Executive Summary Report 2026.txt", text, deflate: true },
    ]),
  );

  expect(bundle.kind).toBe("ratios");
  expect(bundle.year).toBe("2026");
  const report = bundle.reports[0];
  expect(report?.name).toBe("Executive Summary Report");
  expect(report?.columns).toEqual([
    { mdrm: "UBPRE001", mnemonic: "UBPR:NetIncome", description: "Net income" },
    { mdrm: "UBPRE002", mnemonic: "UBPR:ROA", description: "Return on assets" },
  ]);
  expect(report?.filings).toHaveLength(2);
  expect(report?.filings[0]).toMatchObject({
    periodEnd: "2026-03-31",
    rssdId: 37,
    peerGroup: "1",
    values: { UBPRE001: "12", UBPRE002: "1.05" },
  });
  expect(report?.filings[1]?.rssdId).toBeUndefined();
  expect(report?.filings[1]?.periodEnd).toBe("2025-12-31");
});

// ---------------------------------------------------------------------------
// Transport chain against a scripted CDR
// ---------------------------------------------------------------------------

interface ScriptedCdr {
  readonly fetch: SourceFetch;
  readonly stages: string[];
}

function scriptedCdr(zip: Uint8Array): ScriptedCdr {
  const stages: string[] = [];
  const fetchImpl: SourceFetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    expect(url).toBe(FFIEC_CDR_BULK_DATA_URL);
    const headers = new Headers(init?.headers);

    if (init?.method !== "POST") {
      stages.push("landing");
      return Promise.resolve(
        new Response(bulkPageHtml("VS1"), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "set-cookie": "ASP.NET_SessionId=test-session; path=/; HttpOnly",
          },
        }),
      );
    }

    expect(headers.get("cookie") ?? "").toContain("ASP.NET_SessionId=test-session");
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");

    if (form.get(FFIEC_BULK_DOWNLOAD_FIELD) === "Download") {
      stages.push("download");
      expect(form.get("__VIEWSTATE")).toBe("VS4");
      expect(form.get(FFIEC_BULK_PERIOD_FIELD)).toBe("151");
      expect(form.get(FFIEC_BULK_FORMAT_FIELD)).toBe("TSVRadioButton");
      return Promise.resolve(
        new Response(zip.slice(), {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition":
              'attachment; filename="FFIEC CDR Call Bulk All Schedules 03312026.zip"',
          },
        }),
      );
    }

    const target = form.get("__EVENTTARGET");
    if (target === FFIEC_BULK_PRODUCT_FIELD) {
      stages.push("product");
      expect(form.get("__VIEWSTATE")).toBe("VS1");
      expect(form.get(FFIEC_BULK_PRODUCT_FIELD)).toBe("ReportingSeriesSinglePeriod");
      return Promise.resolve(
        new Response(bulkPageHtml("VS2", { periods: true }), {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
    if (target === FFIEC_BULK_PERIOD_FIELD) {
      stages.push("period");
      expect(form.get("__VIEWSTATE")).toBe("VS2");
      return Promise.resolve(
        new Response(bulkPageHtml("VS3", { periods: true }), {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
    stages.push("format");
    expect(form.get("__VIEWSTATE")).toBe("VS3");
    expect(target).toBe("ctl00$MainContentHolder$TSVRadioButton");
    return Promise.resolve(
      new Response(bulkPageHtml("VS4", { periods: true }), {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
  };
  return { fetch: fetchImpl, stages };
}

test("call report fetch drives the postback chain and flattens filtered rows", async () => {
  const cdr = scriptedCdr(callBundleZip());
  const release = await fetchFfiecCallReport({ fetch: cdr.fetch, rssdIds: [37] });

  expect(cdr.stages).toEqual(["landing", "product", "period", "format", "download"]);
  expect(release).toBeDefined();
  expect(release?.provider).toBe("ffiec-cdr");
  expect(release?.dataset).toBe("call-single-period");
  expect(release?.asOf).toBe("2026-03-31");
  expect(release?.updatedAt).toBe("2026-07-15");
  expect(release?.url).toBe(FFIEC_CDR_BULK_DATA_URL);

  expect(release?.rows.map((row) => row.schedule).toSorted()).toEqual(["RC", "RI"]);
  const rc = release?.rows.find((row) => row.schedule === "RC");
  expect(rc).toMatchObject({
    rssdId: 37,
    name: "BANK OF EXAMPLE",
    periodEnd: "2026-03-31",
    values: { RCON2170: "1000", RCON2200: "800", RCON3210: "90" },
  });
});

test("schedule filter and limit bound the flattened rows", async () => {
  const cdr = scriptedCdr(callBundleZip());
  const release = await fetchFfiecCallReport({ fetch: cdr.fetch, schedules: ["rc"], limit: 1 });
  expect(release?.rows).toHaveLength(1);
  expect(release?.rows[0]?.schedule).toBe("RC");
});

test("ifNewerThan skips the download when the period is not newer", async () => {
  const cdr = scriptedCdr(callBundleZip());
  const release = await fetchFfiecCallReport({ fetch: cdr.fetch, ifNewerThan: "2026-03-31" });
  expect(release).toBeUndefined();
  expect(cdr.stages).toEqual(["landing", "product"]);
});

test("downloadFfiecBulkData returns the archive with its filename", async () => {
  const zip = callBundleZip();
  const cdr = scriptedCdr(zip);
  const download = await downloadFfiecBulkData(
    { product: "call-single", period: "2026-03-31", format: "tsv" },
    { fetch: cdr.fetch },
  );
  expect(download.filename).toBe("FFIEC CDR Call Bulk All Schedules 03312026.zip");
  expect(download.period).toEqual({ formValue: "151", label: "03/31/2026" });
  expect(download.callUpdated).toBe("2026-07-15");
  expect(download.bytes).toEqual(zip);
});

test("ffiec data source rides the data lane with skip-aware polling", async () => {
  const source = ffiecCallDataSource({ fetch: scriptedCdr(callBundleZip()).fetch, rssdIds: [37] });
  expect(source.provider).toBe("ffiec-cdr");
  expect(source.requestUrls()).toEqual([FFIEC_CDR_BULK_DATA_URL]);

  const result = await fetchDataRelease(source);
  expect(result.status).toBe("ok");
  expect(result.rowCount).toBe(2);
  expect(result.release?.asOf).toBe("2026-03-31");

  const skipped = await fetchDataRelease(source, { ifNewerThan: "2026-03-31" });
  expect(skipped.status).toBe("empty");
  expect(skipped.release).toBeUndefined();
});

test("release renders as a single data-kind news item", async () => {
  const cdr = scriptedCdr(callBundleZip());
  const release = await fetchFfiecCallReport({ fetch: cdr.fetch });
  const items = ffiecReleaseToNewsItems(release!);

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "ffiec-cdr",
    kind: "data",
    source: "FFIEC CDR",
    reportDate: "2026-03-31",
    eventKind: "regulatory",
  });
  expect(items[0]?.title).toBe("FFIEC call reports as of 2026-03-31: 2 filers across 2 schedules");
  expect(items[0]?.publishedAtText).toBe("2026-07-15");
  expect(items[0]?.tags).toEqual(["ffiec", "call-report", "call-single-period"]);
  expect(ffiecReleaseToNewsItems({ ...release!, rows: [] })).toEqual([]);
});
