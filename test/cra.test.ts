import { expect, test } from "bun:test";
import {
  CRA_ARCHIVE_MAX_BYTES,
  CRA_FLAT_FILE_KINDS,
  CRA_FLAT_FILE_YEARS,
  craDataSource,
  craFlatFileSpecsUrl,
  craFlatFileUrl,
  fetchCraAvailableYears,
  fetchCraFlatFile,
  fetchCraRelease,
  parseCraAvailableYears,
  parseCraFlatFileArchive,
  parseCraFlatFileCatalog,
  parseCraRecord,
} from "../src/index.js";
import type { SourceFetch } from "../src/types.js";

// Hand-trimmed records from the original 1996 and 2024 FFIEC archives.
const TRANS_2024 =
  "000000000112024WELLS FARGO BANK NA           420 MONTGOMERY                          SAN FRANCISCO            CA94104     94-134739300004519651733244000";
const AGGREGATE_2024 =
  "A1-1 20244148059101800301.01NS103   00000000950000001841000000000300000004950000000004000000186100000000440000001672";
// State-level table: a five-character id ending in `a` over an 80-character
// record, which the county-level layout above does not exercise.
const AGGREGATE_LENDER_2024 =
  "A1-1a202441     10180           000622100000003496000013176500000017190000040075";
const DISCLOSURE_D5_2024 = "D5-0 00000000011202460000000477000723841300000000010000208627O";
const TRANS_1996 =
  "000000000111996CORESTATES BANK, N.A.         P.O. BOX 7618                           PHILADELPHIA             PA19101-    23-0972337";
const AGGREGATE_1996 =
  "A1-11996414844100400110.00NS101   00002500000356000002000002700000000000000000001300000453".padEnd(
    113,
    " ",
  );

function storedZip(name: string, text: string): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const data = encoder.encode(text);
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
const neverFetch: SourceFetch = () => {
  throw new Error("fetch should not be called");
};

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error", { cause: error });
  }
  throw new Error("Expected a rejection");
}

test("CRA URL catalog builds verified original archive and layout URLs", () => {
  expect(CRA_FLAT_FILE_KINDS.map((definition) => definition.kind)).toEqual([
    "transmittal",
    "aggregate",
    "disclosure",
  ]);
  expect(CRA_FLAT_FILE_YEARS.at(0)).toBe(2024);
  expect(CRA_FLAT_FILE_YEARS.at(-1)).toBe(1996);
  expect(craFlatFileUrl(2024, "aggregate")).toBe(
    "https://www.ffiec.gov/sites/default/files/data/cra/flat-files/24exp_aggr.zip",
  );
  expect(craFlatFileSpecsUrl(1996, "disclosure")).toBe(
    "https://www.ffiec.gov/sites/default/files/data/cra/flat-files/96FlatDiscSpecs.pdf",
  );
  expect(() => craFlatFileUrl(2025, "aggregate")).toThrow(RangeError);
  expect(() => craFlatFileUrl(1995, "aggregate")).toThrow(RangeError);
  expect(() => Reflect.apply(craFlatFileUrl, undefined, [2024, "unknown"])).toThrow(RangeError);
});

test("CRA catalog parser discovers years and exact kind-specific links", () => {
  const html = `<h1>Aggregate &amp; Disclosure Flat Files</h1>
    <a href="/sites/default/files/data/cra/flat-files/24exp_trans.zip">Transmittal</a>
    <a href="/sites/default/files/data/cra/flat-files/24exp_aggr.zip">Aggregate</a>
    <a href="/sites/default/files/data/cra/flat-files/24exp_discl.zip">Disclosure</a>
    <a href="/sites/default/files/data/cra/flat-files/23exp_aggr.zip">Prior aggregate</a>`;
  const catalog = parseCraFlatFileCatalog(html);
  expect(catalog).toHaveLength(4);
  expect(parseCraAvailableYears(html)).toEqual([2024, 2023]);
  expect(catalog.find((entry) => entry.kind === "disclosure")?.url).toBe(
    "https://www.ffiec.gov/sites/default/files/data/cra/flat-files/24exp_discl.zip",
  );
  expect(() => parseCraFlatFileCatalog("<html><h1>Not CRA</h1></html>")).toThrow(
    "unexpected CRA flat-files catalog response shape",
  );
});

test("CRA fixed-width parser types real aggregate and community-development records", () => {
  const aggregate = parseCraRecord(AGGREGATE_2024, "aggregate");
  expect(aggregate.kind).toBe("aggregate");
  if (aggregate.kind !== "aggregate" || !("loanCountUnder100k" in aggregate)) {
    throw new Error("expected an aggregate loan row");
  }
  expect(aggregate.recordType).toBe("A1-1");
  expect(aggregate.activityYear).toBe(2024);
  expect(aggregate.state).toBe("48");
  expect(aggregate.county).toBe("059");
  expect(aggregate.censusTract).toBe("0301.01");
  expect(aggregate.loanCountUnder100k).toBe(95);
  expect(aggregate.loanAmountUnder100kThousands).toBe(1841);
  expect(aggregate.grossRevenueUnder1mLoanAmountThousands).toBe(1672);
  expect(aggregate.rawRecord).toBe(AGGREGATE_2024);
  const legacy = parseCraRecord(AGGREGATE_1996, "aggregate");
  if (legacy.kind !== "aggregate" || !("loanCountUnder100k" in legacy)) {
    throw new Error("expected a legacy aggregate loan row");
  }
  expect(legacy.activityYear).toBe(1996);
  expect(legacy.state).toBe("48");
  expect(legacy.county).toBe("441");
  expect(legacy.msaMd).toBe("0040");
  expect(legacy.loanCountUnder100k).toBe(25);
  expect(legacy.loanAmountUnder100kThousands).toBe(356);

  const legacyTransmittal = parseCraRecord(TRANS_1996, "transmittal");
  if (legacyTransmittal.recordType !== "transmittal") {
    throw new Error("expected a legacy transmittal row");
  }
  expect(legacyTransmittal.activityYear).toBe(1996);
  expect(legacyTransmittal.respondentName).toBe("CORESTATES BANK, N.A.");
  expect(legacyTransmittal.rssdId).toBeUndefined();
  expect(legacyTransmittal.assetsThousands).toBeUndefined();

  const community = parseCraRecord(DISCLOSURE_D5_2024, "disclosure");
  expect(community.recordType).toBe("D5-0");
  if (community.recordType !== "D5-0") throw new Error("expected a D5-0 row");
  expect(community.loanType).toBe(6);
  expect(community.loanCount).toBe(477);
  expect(community.actionType).toBe("O");
});

test("CRA state-level `a` tables parse rather than reading as an unknown record type", () => {
  const lender = parseCraRecord(AGGREGATE_LENDER_2024, "aggregate");

  expect(lender.recordType).toBe("A1-1a");
  expect(lender.activityYear).toBe(2024);
  expect(lender.rawRecord).toBe(AGGREGATE_LENDER_2024);
  expect(() => parseCraRecord(`A9-9a${AGGREGATE_LENDER_2024.slice(5)}`, "aggregate")).toThrow(
    "unrecognized record-type code",
  );
});

test("CRA transmittal archive fetch uses injected transport and the larger archive ceiling", async () => {
  const archive = storedZip("CRA2024_Transmittal.dat", `${TRANS_2024}\r\n`);
  let requestedUrl = "";
  const injected: SourceFetch = async (input) => {
    requestedUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    return new Response(archive.slice(), { headers: { "content-type": "application/zip" } });
  };

  const file = await fetchCraFlatFile(2024, "transmittal", { fetch: injected });

  expect(requestedUrl).toBe(craFlatFileUrl(2024, "transmittal"));
  expect(CRA_ARCHIVE_MAX_BYTES).toBeGreaterThan(32 * 1024 * 1024);
  expect(file.archiveSizeBytes).toBe(archive.byteLength);
  expect(file.rows).toHaveLength(1);
  const row = file.rows[0];
  expect(row?.recordType).toBe("transmittal");
  if (row?.recordType !== "transmittal") throw new Error("expected a transmittal row");
  expect(row.respondentName).toBe("WELLS FARGO BANK NA");
  expect(row.assetsThousands).toBe(1_733_244_000);
  expect(row.rawRecord).toBe(TRANS_2024);
});

test("CRA numeric coercion warns without discarding the record", () => {
  const malformedCount = `${AGGREGATE_2024.slice(0, 36)}not-a-num!${AGGREGATE_2024.slice(46)}`;
  const row = parseCraRecord(malformedCount, "aggregate");
  if (row.kind !== "aggregate" || !("loanCountUnder100k" in row)) {
    throw new Error("expected an aggregate loan row");
  }
  expect(row.loanCountUnder100k).toBeUndefined();
  expect(row.warnings).toEqual([
    'CRA A1-1: could not coerce under-$100,000 loan count "not-a-num!"',
  ]);
});

test("CRA parser fails closed on unknown record types, short records, and truncated ZIPs", async () => {
  expect(() => parseCraRecord(`Z9-9 ${" ".repeat(111)}`, "aggregate")).toThrow(
    "unrecognized record-type code",
  );
  expect(() => parseCraRecord("A1-1 2024", "aggregate")).toThrow("truncated record");
  const failure = await captureError(
    parseCraFlatFileArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 2024, "aggregate"),
  );
  expect(failure.message).not.toBe("");
});

test("CRA limit zero performs no network I/O", async () => {
  expect(await fetchCraAvailableYears({ fetch: neverFetch, limit: 0 })).toEqual([]);
  expect((await fetchCraFlatFile(2024, "aggregate", { fetch: neverFetch, limit: 0 })).rows).toEqual(
    [],
  );
  expect(
    await fetchCraRelease("aggregate", { year: 2024, fetch: neverFetch, limit: 0 }),
  ).toBeUndefined();
  expect(craDataSource("aggregate", { year: 2024, limit: 0 }).requestUrls()).toEqual([]);
});

test("CRA ifNewerThan skips an explicit year before fetching the archive", async () => {
  const source = craDataSource("aggregate", { year: 2024, fetch: neverFetch });
  expect(await source.fetchRelease({ ifNewerThan: "2024-12-31" })).toBeUndefined();
  expect(source.requestUrls({ ifNewerThan: "2024-12-31" })).toEqual([]);
});
