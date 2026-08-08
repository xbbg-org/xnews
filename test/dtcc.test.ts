import { deflateRawSync } from "node:zlib";
import { expect, test } from "bun:test";
import {
  PROVIDER_POLICIES,
  buildTopicNewsFeedResult,
  createDataReleaseWatcher,
  dtccCumulativeDataSource,
  dtccCumulativeFileName,
  dtccCumulativeUrl,
  dtccReleaseToNewsItems,
  dtccSliceCatalogUrl,
  dtccSliceDataSource,
  dtccSliceUrl,
  fetchDataRelease,
  fetchDtccCumulativeEvents,
  fetchDtccSliceCatalog,
  fetchDtccSliceEvents,
  parseDtccSliceCatalog,
  parseDtccSliceFileName,
  parseDtccTradeCsv,
  parseDtccTradeZip,
} from "../src/index.js";
import type { DataRelease, DataSource, DtccSliceCatalogEntry } from "../src/index.js";
import type { SourceFetch } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildZip(inputs: readonly { name: string; text: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const input of inputs) {
    const nameBytes = encoder.encode(input.name);
    const data = encoder.encode(input.text);
    const payload = new Uint8Array(deflateRawSync(data));
    const crc = Bun.hash.crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const record = new Uint8Array(46 + nameBytes.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true);
    recordView.setUint16(4, 20, true);
    recordView.setUint16(6, 20, true);
    recordView.setUint16(10, 8, true);
    recordView.setUint32(16, crc, true);
    recordView.setUint32(20, payload.length, true);
    recordView.setUint32(24, data.length, true);
    recordView.setUint16(28, nameBytes.length, true);
    recordView.setUint32(42, offset, true);
    record.set(nameBytes, 46);

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

  const archive = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, eocd]) {
    archive.set(chunk, cursor);
    cursor += chunk.length;
  }
  return archive;
}

const TRADE_CSV = [
  '"Dissemination Identifier","Original Dissemination Identifier","Action type","Event type","Event timestamp","Execution Timestamp","Effective Date","Expiration Date","Asset Class","Product name","Cleared","Platform identifier","Notional amount-Leg 1","Notional currency-Leg 1","Fixed rate-Leg 1","Spread-Leg 1","Spread notation-Leg 1","Price","Price notation","Package indicator","Unique Product Identifier","UPI FISN","UPI Underlier Name"',
  '"1001","","NEWT","TRAD","2026-08-08T06:45:18Z","2026-08-07T12:58:24Z","2025-09-22","2030-12-20","CR","","N","SEF1","25,000,000+","USD","0.01","0.0055","3","","","","QZX1","NA/CDS Corp Idx","CDX.NA.IG"',
  '"1002","0999","MODI","TRAD","2026-08-08T06:46:00Z","","","2031-06-20","CR"," CDX Tranche ","I","","4,000,000","USD","","","","99.5","1","F","QZX2","NA/CDS Corp Idx","CDX.NA.HY"',
].join("\r\n");

function catalogJson(entries: readonly Partial<DtccSliceCatalogEntry>[]): string {
  return JSON.stringify(
    entries.map((entry) => ({
      sliceId: entry.sliceId,
      fileName: entry.fileName,
      startTs: entry.startTs ?? "2026-08-08T06:00:00Z",
      endTs: entry.endTs ?? "2026-08-08T06:10:00Z",
      rowCount: entry.rowCount ?? 1,
      dissemDTM: entry.dissemDTM ?? "2026-08-08T06:10:01Z",
      ...(entry.url === undefined ? {} : { fullFilePath: entry.url }),
    })),
  );
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

test("url builders encode the verified PPD endpoint scheme", () => {
  expect(dtccSliceCatalogUrl("cftc", "credits")).toBe(
    "https://pddata.dtcc.com/ppd/api/slice/CFTC/CR",
  );
  expect(dtccSliceCatalogUrl("sec", "rates")).toBe("https://pddata.dtcc.com/ppd/api/slice/SEC/IR");
  expect(dtccSliceUrl("cftc", "CFTC_SLICE_CREDITS_2026_08_08_1.zip")).toBe(
    "https://kgc0418-tdw-data-0.s3.amazonaws.com/cftc/slices/CFTC_SLICE_CREDITS_2026_08_08_1.zip",
  );
  expect(dtccCumulativeFileName("cftc", "credits", "2026-08-07")).toBe(
    "CFTC_CUMULATIVE_CREDITS_2026_08_07.zip",
  );
  expect(dtccCumulativeUrl("sec", "equities", "2026-08-07")).toBe(
    "https://kgc0418-tdw-data-0.s3.amazonaws.com/sec/eod/SEC_CUMULATIVE_EQUITIES_2026_08_07.zip",
  );
  expect(() => dtccCumulativeFileName("cftc", "credits", "08/07/2026")).toThrow(RangeError);
});

test("slice file names round-trip through the parser", () => {
  expect(parseDtccSliceFileName("CFTC_SLICE_CREDITS_2026_08_08_57.zip")).toEqual({
    agency: "cftc",
    assetClass: "credits",
    date: "2026-08-08",
    ordinal: 57,
  });
  expect(parseDtccSliceFileName("SEC_SLICE_EQUITIES_2026_08_07_506.zip")?.agency).toBe("sec");
  expect(parseDtccSliceFileName("CFTC_CUMULATIVE_CREDITS_2026_08_07.zip")).toBeUndefined();
  expect(parseDtccSliceFileName("CFTC_SLICE_WIDGETS_2026_08_08_1.zip")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

test("slice catalog accepts a true empty catalog", () => {
  expect(parseDtccSliceCatalog("[]")).toEqual([]);
});

test("slice catalog rejects a non-empty all-invalid catalog without reflecting its body", () => {
  const reflectedSecret = "authorization=reflected-secret";
  const body = JSON.stringify([
    null,
    { sliceId: 1 },
    { fileName: "orphan-without-slice-id.zip" },
    { sliceId: 2, fileName: "" },
    { sliceId: 4, fileName: " \t " },
    { sliceId: "3", fileName: reflectedSecret },
  ]);

  try {
    parseDtccSliceCatalog(body);
    throw new Error("expected response-shape validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("expected response-shape validation to throw an Error", { cause: error });
    }
    expect(error.message).toBe("unexpected DTCC slice catalog response shape");
    expect(error.message).not.toContain(reflectedSecret);
  }
});

test("slice catalog trims fields and keeps valid mixed entries in ascending sliceId order", () => {
  const body = catalogJson([
    {
      sliceId: 3,
      fileName: " CFTC_SLICE_CREDITS_2026_08_08_2.zip ",
      url: " https://example.com/2 ",
    },
    { fileName: "orphan-without-slice-id.zip" },
    { sliceId: 2, fileName: " \t " },
    { sliceId: 1, fileName: "CFTC_SLICE_CREDITS_2026_08_07_227.zip", url: " \t " },
  ]);
  const entries = parseDtccSliceCatalog(body);
  expect(entries.map((entry) => entry.sliceId)).toEqual([1, 3]);
  expect(entries.map((entry) => entry.fileName)).toEqual([
    "CFTC_SLICE_CREDITS_2026_08_07_227.zip",
    "CFTC_SLICE_CREDITS_2026_08_08_2.zip",
  ]);
  expect(entries[0]?.url).toBe(
    "https://kgc0418-tdw-data-0.s3.amazonaws.com/cftc/slices/CFTC_SLICE_CREDITS_2026_08_07_227.zip",
  );
  expect(entries[1]?.url).toBe("https://example.com/2");
  expect(() => parseDtccSliceCatalog("<html>maintenance</html>")).toThrow("non-JSON");
  const reflectedSecret = "authorization=reflected-secret";
  try {
    parseDtccSliceCatalog(`<html>${reflectedSecret}</html>`);
    throw new Error("expected response-shape validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("expected response-shape validation to throw an Error", { cause: error });
    }
    expect(error.message).not.toContain(reflectedSecret);
  }
});

test("trade CSV normalizes typed columns and keeps the raw row", () => {
  const events = parseDtccTradeCsv(TRADE_CSV, { fileName: "slice.csv" });
  expect(events).toHaveLength(2);

  const first = events[0]!;
  expect(first.disseminationId).toBe("1001");
  expect(first.originalDisseminationId).toBeNull();
  expect(first.lineageId).toBe("1001");
  expect(first.actionType).toBe("NEWT");
  expect(first.executionTimestamp).toBe("2026-08-07T12:58:24Z");
  expect(first.notionalAmountLeg1).toBe("25,000,000+");
  expect(first.spreadLeg1).toBe("0.0055");
  expect(first.productName).toBeNull();
  expect(first.upiUnderlierName).toBe("CDX.NA.IG");
  expect(first.raw["Notional currency-Leg 1"]).toBe("USD");

  const second = events[1]!;
  expect(second.lineageId).toBe("0999");
  expect(second.productName).toBe("CDX Tranche");
  expect(second.price).toBe("99.5");
  expect(second.rowNumber).toBe(2);

  expect(parseDtccTradeCsv(TRADE_CSV, { limit: 1 })).toHaveLength(1);
  expect(() => parseDtccTradeCsv('"Action type"\r\n"NEWT"', { fileName: "bad.csv" })).toThrow(
    "Dissemination Identifier",
  );
});

test("a slice CSV cut inside a quoted field is rejected, not read as a short row", () => {
  const truncated = `${TRADE_CSV.slice(0, TRADE_CSV.indexOf("\n", TRADE_CSV.indexOf("\n") + 1))}\n"1003","NEWT","2026-08-07T13`;

  expect(() => parseDtccTradeCsv(truncated, { fileName: "slice.csv" })).toThrow(
    "CSV ends inside a quoted field",
  );
});

test("trade ZIP extraction finds the CSV member and rejects CSV-less archives", async () => {
  const zip = buildZip([
    { name: "readme.txt", text: "not trades" },
    { name: "CFTC_SLICE_CREDITS_2026_08_08_1.csv", text: TRADE_CSV },
  ]);
  const events = await parseDtccTradeZip(zip);
  expect(events).toHaveLength(2);
  expect(events[0]?.fileName).toBe("CFTC_SLICE_CREDITS_2026_08_08_1.csv");

  let csvless: unknown;
  try {
    await parseDtccTradeZip(buildZip([{ name: "only.txt", text: "x" }]));
  } catch (error) {
    csvless = error;
  }
  expect(String(csvless)).toContain("No CSV member");
});

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

const SLICE_ZIP = buildZip([{ name: "CFTC_SLICE_CREDITS_2026_08_08_1.csv", text: TRADE_CSV }]);

function dispatchFetch(routes: (url: string) => Response | undefined): SourceFetch {
  return async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const response = routes(url);
    if (response === undefined) throw new Error(`unexpected request: ${url}`);
    return response;
  };
}

test("slice catalog fetch dials the PPD API and honors date bounds", async () => {
  const requested: string[] = [];
  const fetchStub = dispatchFetch((url) => {
    requested.push(url);
    return new Response(
      catalogJson([
        { sliceId: 2, fileName: "CFTC_SLICE_CREDITS_2026_08_08_1.zip" },
        { sliceId: 1, fileName: "CFTC_SLICE_CREDITS_2026_08_07_227.zip" },
      ]),
    );
  });
  const entries = await fetchDtccSliceCatalog({ fetch: fetchStub });
  expect(requested).toEqual(["https://pddata.dtcc.com/ppd/api/slice/CFTC/CR"]);
  expect(entries.map((entry) => entry.sliceId)).toEqual([1, 2]);

  const bounded = await fetchDtccSliceCatalog({
    fetch: fetchStub,
    since: "2026-08-07T23:30:00-02:00",
  });
  expect(bounded.map((entry) => entry.sliceId)).toEqual([2]);
});

test("DTCC rejects invalid caller dates before URL construction or I/O", async () => {
  let calls = 0;
  const counting: SourceFetch = async () => {
    calls += 1;
    return new Response(SLICE_ZIP.slice());
  };

  const invalidCalls = [
    () => fetchDtccSliceCatalog({ fetch: counting, limit: 0, until: "2026-02-30" }),
    () =>
      fetchDtccSliceEvents("CFTC_SLICE_CREDITS_2026_08_08_1.zip", {
        fetch: counting,
        since: new Date(Number.NaN),
      }),
    () => fetchDtccCumulativeEvents("2026-02-30", { fetch: counting }),
    () =>
      fetchDtccCumulativeEvents(undefined, {
        fetch: counting,
        ifNewerThan: "not a date",
      }),
  ];
  for (const invalidCall of invalidCalls) {
    let failure: unknown;
    try {
      await invalidCall();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(RangeError);
    expect(failure).toHaveProperty(
      "message",
      expect.stringContaining("must be a valid date or ISO date-time"),
    );
  }
  expect(calls).toBe(0);

  for (const source of [
    dtccSliceDataSource({ since: "not a date" }),
    dtccCumulativeDataSource({ until: "2026-02-30" }),
  ]) {
    const wrapped = await fetchDataRelease(source, { fetch: counting });
    expect(wrapped.status).toBe("error");
    expect(wrapped.release).toBeUndefined();
    expect(wrapped.requestUrls).toEqual([]);
    expect(wrapped.error?.message).toContain("must be a valid date or ISO date-time");
  }
  expect(calls).toBe(0);
});

test("slice download parses the ZIP and treats a rotated-out 404 as empty", async () => {
  const events = await fetchDtccSliceEvents("CFTC_SLICE_CREDITS_2026_08_08_1.zip", {
    fetch: dispatchFetch(() => new Response(SLICE_ZIP.slice())),
  });
  expect(events).toHaveLength(2);

  const gone = await fetchDtccSliceEvents("CFTC_SLICE_CREDITS_2026_08_08_9.zip", {
    fetch: dispatchFetch(() => new Response("", { status: 404 })),
  });
  expect(gone).toEqual([]);
});

test("cumulative fetch walks back to the newest published business date", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const yesterdayFile = dtccCumulativeFileName("cftc", "credits", yesterday);
  const requested: string[] = [];
  const fetchStub = dispatchFetch((url) => {
    requested.push(url);
    return url.endsWith(yesterdayFile)
      ? new Response(SLICE_ZIP.slice())
      : new Response("", { status: 403 });
  });

  const release = await fetchDtccCumulativeEvents(undefined, { fetch: fetchStub });
  expect(release?.businessDate).toBe(yesterday);
  expect(release?.fileName).toBe(yesterdayFile);
  expect(release?.events).toHaveLength(2);
  expect(requested).toEqual([
    dtccCumulativeUrl("cftc", "credits", today),
    dtccCumulativeUrl("cftc", "credits", yesterday),
  ]);
});

test("cumulative fetch honors ifNewerThan without dialing and explicit-date misses", async () => {
  let calls = 0;
  const counting: SourceFetch = async () => {
    calls += 1;
    return new Response("", { status: 404 });
  };
  const today = new Date().toISOString().slice(0, 10);
  expect(await fetchDtccCumulativeEvents(undefined, { fetch: counting, ifNewerThan: today })).toBe(
    undefined,
  );
  expect(calls).toBe(0);

  expect(await fetchDtccCumulativeEvents("2026-08-02", { fetch: counting })).toBeUndefined();
  expect(calls).toBe(1);
});

// ---------------------------------------------------------------------------
// Data lane
// ---------------------------------------------------------------------------

test("slice data source serves the latest slice, then the backlog in order", async () => {
  const catalog = catalogJson([
    { sliceId: 11, fileName: "CFTC_SLICE_CREDITS_2026_08_08_1.zip" },
    { sliceId: 12, fileName: "CFTC_SLICE_CREDITS_2026_08_08_2.zip" },
    { sliceId: 13, fileName: "CFTC_SLICE_CREDITS_2026_08_08_3.zip" },
  ]);
  const fetchStub = dispatchFetch((url) => {
    if (url.endsWith("/slice/CFTC/CR")) return new Response(catalog);
    // Slice 12 rotated out between catalog read and download.
    if (url.includes("_2.zip")) return new Response("", { status: 404 });
    return new Response(SLICE_ZIP.slice());
  });

  const source = dtccSliceDataSource({ fetch: fetchStub });
  expect(source.provider).toBe("dtcc-sdr");
  expect(source.dataset).toBe("cftc-credits-slices");
  expect(source.requestUrls()).toEqual(["https://pddata.dtcc.com/ppd/api/slice/CFTC/CR"]);

  const latest = await source.fetchRelease();
  expect(latest?.sequence).toBe(13);
  expect(latest?.asOf).toBe("2026-08-08");
  expect(latest?.rows).toHaveLength(2);

  // Backlog after slice 11: slice 12 vanished, so slice 13 is next.
  const next = await source.fetchRelease({ afterSequence: 11 });
  expect(next?.sequence).toBe(13);

  expect(await source.fetchRelease({ afterSequence: 13 })).toBeUndefined();
});

test("slice data source never emits an invalid catalog date as release asOf", async () => {
  const requested: string[] = [];
  const malformedCatalog = catalogJson([
    { sliceId: 14, fileName: "CFTC_SLICE_CREDITS_2026_02_30_1.zip" },
  ]);
  const fetchStub = dispatchFetch((url) => {
    requested.push(url);
    return url.endsWith("/slice/CFTC/CR")
      ? new Response(malformedCatalog)
      : new Response(SLICE_ZIP.slice());
  });

  const result = await fetchDataRelease(dtccSliceDataSource({ fetch: fetchStub }));
  expect(result.status).toBe("error");
  expect(result.release).toBeUndefined();
  expect(result.error?.message).toBe("unexpected DTCC slice catalog response shape");
  expect(requested).toEqual(["https://pddata.dtcc.com/ppd/api/slice/CFTC/CR"]);
});

test("cumulative data source rides the generic release machinery", async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const fetchStub = dispatchFetch((url) =>
    url.endsWith(dtccCumulativeFileName("cftc", "credits", yesterday))
      ? new Response(SLICE_ZIP.slice())
      : new Response("", { status: 404 }),
  );
  const result = await fetchDataRelease(dtccCumulativeDataSource({ fetch: fetchStub }));
  expect(result.status).toBe("ok");
  expect(result.provider).toBe("dtcc-sdr");
  expect(result.dataset).toBe("cftc-credits-eod");
  expect(result.rowCount).toBe(2);
  expect(result.release?.asOf).toBe(yesterday);
  expect(result.release?.sequence).toBeUndefined();
});

const sequencedRelease = (sequence: number): DataRelease<{ n: number }> => ({
  provider: "dtcc-sdr",
  dataset: "cftc-credits-slices",
  asOf: "2026-08-08",
  sequence,
  url: `https://example.com/${sequence}`,
  rows: [{ n: sequence }],
});

test("watcher drains sequenced backlogs without sleeping between polls", async () => {
  const controller = new AbortController();
  const served: (number | undefined)[] = [];
  const source: DataSource<{ n: number }> = {
    provider: "dtcc-sdr",
    dataset: "cftc-credits-slices",
    requestUrls: () => [],
    fetchRelease: async (options = {}) => {
      served.push(options.afterSequence);
      const after = options.afterSequence ?? 0;
      // Slices 21..23 exist; nothing newer afterwards.
      if (after >= 23) return undefined;
      return sequencedRelease(Math.max(after + 1, 21));
    },
  };

  const seen: number[] = [];
  // A one-hour interval proves draining never waits on the poll timer:
  // reaching three yields within the test timeout requires `continue`.
  const watcher = createDataReleaseWatcher(source, {
    intervalMs: 3_600_000,
    signal: controller.signal,
    sinceSequence: 20,
  });
  for await (const result of watcher) {
    seen.push(result.release?.sequence ?? -1);
    if (seen.length === 3) controller.abort();
  }
  expect(seen).toEqual([21, 22, 23]);
  expect(served).toEqual([20, 21, 22]);
});

test("watcher date gate still applies before the first sequenced yield", async () => {
  const controller = new AbortController();
  let polls = 0;
  const source: DataSource<{ n: number }> = {
    provider: "dtcc-sdr",
    dataset: "cftc-credits-slices",
    requestUrls: () => [],
    fetchRelease: async () => {
      polls += 1;
      return {
        provider: "dtcc-sdr",
        dataset: "cftc-credits-slices",
        asOf: polls === 1 ? "2026-08-07" : "2026-08-08",
        sequence: polls === 1 ? 5 : 6,
        url: "https://example.com",
        rows: [{ n: polls }],
      };
    },
  };
  const watcher = createDataReleaseWatcher(source, {
    intervalMs: 1,
    signal: controller.signal,
    sinceAsOf: "2026-08-07",
  });
  const first = await watcher.next();
  controller.abort();
  await watcher.next().catch(() => undefined);
  expect(first.done === false && first.value.release?.sequence).toBe(6);
});

// ---------------------------------------------------------------------------
// News bridge and feed plumbing
// ---------------------------------------------------------------------------

test("dtccReleaseToNewsItems renders one summary item per release", () => {
  const rows = parseDtccTradeCsv(TRADE_CSV, { fileName: "slice.csv" });
  const items = dtccReleaseToNewsItems({
    provider: "dtcc-sdr",
    dataset: "cftc-credits-slices",
    asOf: "2026-08-08",
    sequence: 34232840,
    url: "https://example.com/slice.zip",
    rows,
  });
  expect(items).toHaveLength(1);
  const item = items[0]!;
  expect(item.provider).toBe("dtcc-sdr");
  expect(item.kind).toBe("data");
  expect(item.title).toBe("DTCC CFTC credits slice 34232840 (2026-08-08): 2 swap disseminations");
  expect(item.source).toBe("DTCC SDR");
  expect(item.reportDate).toBe("2026-08-08");
  expect(item.summary).toContain("NEWT 1");
  expect(item.summary).toContain("MODI 1");
  expect(item.summary).toContain("CDX.NA.IG 1");
  expect(item.tags).toEqual(["dtcc", "cftc", "credits", "slices"]);

  expect(
    dtccReleaseToNewsItems({
      provider: "dtcc-sdr",
      dataset: "cftc-credits-eod",
      asOf: "2026-08-07",
      url: "https://example.com/eod.zip",
      rows: [],
    }),
  ).toEqual([]);
});

test("dtcc-sdr participates in feed plumbing only as an explicit no-op", async () => {
  expect(PROVIDER_POLICIES["dtcc-sdr"]?.notes).toContain("Public Price Dissemination");
  const result = await buildTopicNewsFeedResult({
    query: "credit swaps",
    sources: ["dtcc-sdr"],
    fetch: async () => {
      throw new Error("must not dial");
    },
  });
  expect(result.providers).toHaveLength(1);
  expect(result.providers[0]?.status).toBe("unsupported");
  expect(result.providers[0]?.warnings[0]).toContain("fetchDtccSliceCatalog");
});
