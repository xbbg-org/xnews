import { expect, test } from "bun:test";
import { fetchDataRelease } from "../src/data.js";
import {
  fetchFfiecE16Release,
  ffiecE16DataSource,
  FFIEC_E16_INDEX_URL,
  listFfiecE16Releases,
  parseFfiecE16Index,
  parseFfiecE16Workbook,
} from "../src/sources/ffiece16.js";
import type { SourceFetch } from "../src/types.js";
import type { FfiecE16ReleaseEntry } from "../src/sources/ffiece16.js";

interface ZipFixtureEntry {
  readonly name: string;
  readonly body: string | Uint8Array;
}

function buildStoredZip(entries: readonly ZipFixtureEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.body === "string" ? encoder.encode(entry.body) : entry.body;
    const crc = Bun.hash.crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localChunks.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralChunks.push(central);
    localOffset += local.length;
  }

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, localOffset, true);

  const archive = new Uint8Array(localOffset + centralSize + eocd.length);
  let offset = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    archive.set(chunk, offset);
    offset += chunk.length;
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

const LATEST_URL =
  "https://www.ffiec.gov/sites/default/files/data/e16/Jun-30-2026-E16(009)_Cleansed.xlsx";
const HISTORICAL_URL = "https://www.ffiec.gov/sites/default/files/data/e16/E16_202503.zip";
const WORKSHEET_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const TABLES = ["1", "2", "3", "4.1", "4.2"];
const POPULATIONS = [
  { sheet: "All Banks", label: "All U.S. Banks - Group A" },
  { sheet: "LFI", label: "Large Financial Institutions (LFI) - Group B" },
  { sheet: "All Others", label: "All Other U.S. Banks - Group C" },
];
const DATA_COLUMNS = [
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
];

function indexHtml(): string {
  // Hand-trimmed from the live FFIEC table; the link labels intentionally misstate the formats.
  return `<table><thead><tr>
    <th>Report Date</th><th>Release Date</th><th>Data File</th><th>009a Data Report</th>
  </tr></thead><tbody>
    <tr><td><a href="/sites/default/files/data/e16/E16_202603.pdf">March 31, 2026</a></td>
      <td>July 1, 2026</td><td><a href="${LATEST_URL}">E16_202606.zip</a></td>
      <td><a href="/sites/default/files/data/e16/009a_202603.pdf">March 31, 2026</a></td></tr>
    <tr><td><a href="/sites/default/files/data/e16/E16_20241231.pdf">December 31, 2024</a></td>
      <td>April 2, 2025</td><td><a href="/sites/default/files/data/e16/E16_202503.zip">E16 202503.zip</a></td>
      <td><a href="/sites/default/files/data/e16/009a_202412.pdf">December 31, 2024</a></td></tr>
  </tbody></table>`;
}

function e16Workbook(periodLabel = "March 31, 2026", badFirstMeasure = false): Uint8Array {
  const dataSheets = POPULATIONS.flatMap((population) =>
    TABLES.map((table) => ({
      name: `${population.sheet} - Table ${table}`,
      title: `Country Exposure Lending Survey /1:  ${periodLabel} Table ${table} ($ Millions) ${population.label}`,
    })),
  );
  const sheets = [{ name: "E16_009", title: "" }, ...dataSheets];
  const workbookSheets = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const relationships = sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="${WORKSHEET_RELATIONSHIP}" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const entries: ZipFixtureEntry[] = [
    {
      name: "xl/workbook.xml",
      body: `<workbook xmlns:r="urn:r"><sheets>${workbookSheets}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      body: `<Relationships>${relationships}</Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      body: `<worksheet><sheetData><row r="7"><c r="D7" t="inlineStr"><is><t>Period: ${periodLabel}</t></is></c></row></sheetData></worksheet>`,
    },
  ];

  for (const [index, sheet] of dataSheets.entries()) {
    const measures = DATA_COLUMNS.map((column, columnIndex) => {
      if (badFirstMeasure && index === 0 && columnIndex === 0) {
        return `<c r="${column}3" t="str"><v>not reported</v></c>`;
      }
      return `<c r="${column}3"><v>${columnIndex === 0 ? 31_022 : columnIndex}</v></c>`;
    }).join("");
    entries.push({
      name: `xl/worksheets/sheet${index + 2}.xml`,
      body: `<worksheet><sheetData>
        <row r="1"><c r="B1" t="inlineStr"><is><t>${sheet.title}</t></is></c></row>
        <row r="2"><c r="B2" t="inlineStr"><is><t>G-10 and Luxembourg</t></is></c></row>
        <row r="3"><c r="B3" t="inlineStr"><is><t>BELGIUM</t></is></c>${measures}</row>
      </sheetData></worksheet>`,
    });
  }
  return buildStoredZip(entries);
}

function releaseEntry(format: "xlsx" | "zip"): FfiecE16ReleaseEntry {
  return format === "xlsx"
    ? {
        reportingPeriod: "2026-03-31",
        releasedAt: "2026-07-01",
        label: "E16_202606.zip",
        url: LATEST_URL,
        format,
      }
    : {
        reportingPeriod: "2024-12-31",
        releasedAt: "2025-04-02",
        label: "E16 202503.zip",
        url: HISTORICAL_URL,
        format,
      };
}

test("E.16 index parser discovers actual XLSX and ZIP links instead of trusting labels", () => {
  const releases = parseFfiecE16Index(indexHtml());
  expect(releases).toEqual([releaseEntry("xlsx"), releaseEntry("zip")]);
  expect(() =>
    parseFfiecE16Index("<table><thead><tr><th>Changed</th></tr></thead></table>"),
  ).toThrow("missing its release table");
});

test("E.16 workbook parser emits typed population, region, table, and measure rows", async () => {
  const workbook = await parseFfiecE16Workbook(e16Workbook(), { limit: 1 });
  const row = workbook.rows[0];
  expect(workbook.reportingPeriod).toBe("2026-03-31");
  expect(workbook.sheetNames).toHaveLength(16);
  expect(row?.population).toBe("all-banks");
  expect(row?.populationLabel).toBe("All U.S. Banks - Group A");
  expect(row?.table).toBe("1");
  expect(row?.countryOrRegion).toBe("BELGIUM");
  expect(row?.region).toBe("G-10 and Luxembourg");
  expect(row?.measures[0]).toEqual({
    name: "ultimateRiskCrossBorderClaims",
    raw: 31_022,
    value: 31_022,
  });
  expect(row?.raw[0]).toBeUndefined();
  expect(row?.raw[1]).toBe("BELGIUM");
  expect(row?.warnings).toEqual([]);
});

test("E.16 coercion failures preserve raw values and append warnings", async () => {
  const workbook = await parseFfiecE16Workbook(e16Workbook("March 31, 2026", true), { limit: 1 });
  expect(workbook.rows[0]?.measures[0]).toEqual({
    name: "ultimateRiskCrossBorderClaims",
    raw: "not reported",
  });
  expect(workbook.rows[0]?.warnings).toEqual([
    'ultimateRiskCrossBorderClaims value "not reported" is not a finite number',
  ]);
});

test("E.16 release fetcher handles bare XLSX and ZIP-wrapped workbooks", async () => {
  const currentWorkbook = e16Workbook();
  const historicalWorkbook = e16Workbook("December 31, 2024");
  const wrapped = buildStoredZip([
    { name: "Dec 31 2024 - E16 (009)_Cleansed.xlsx", body: historicalWorkbook },
  ]);
  const fetcher: SourceFetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === LATEST_URL) {
      return new Response(currentWorkbook.slice(), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });
    }
    if (url === HISTORICAL_URL) {
      return new Response(wrapped.slice(), { headers: { "content-type": "application/zip" } });
    }
    return new Response("missing", { status: 404 });
  };

  const current = await fetchFfiecE16Release(releaseEntry("xlsx"), { fetch: fetcher, limit: 1 });
  const historical = await fetchFfiecE16Release(releaseEntry("zip"), { fetch: fetcher, limit: 1 });
  expect(current.asOf).toBe("2026-03-31");
  expect(current.entry.url).toBe(LATEST_URL);
  expect(current.rows[0]?.countryOrRegion).toBe("BELGIUM");
  expect(historical.asOf).toBe("2024-12-31");
  expect(historical.rows[0]?.countryOrRegion).toBe("BELGIUM");
});

test("E.16 data source uses the index as a cheap ifNewerThan probe", async () => {
  const calls: string[] = [];
  const fetcher: SourceFetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url === FFIEC_E16_INDEX_URL) {
      return new Response(indexHtml(), { headers: { "content-type": "text/html" } });
    }
    return new Response("unexpected", { status: 500 });
  };
  const result = await fetchDataRelease(ffiecE16DataSource({ fetch: fetcher }), {
    ifNewerThan: "2026-03-31",
  });
  expect(result.status).toBe("empty");
  expect(result.rowCount).toBe(0);
  expect(calls).toEqual([FFIEC_E16_INDEX_URL]);
});

test("E.16 index fetcher uses injected transport and release failures are sanitized", async () => {
  const fetcher: SourceFetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    return url === FFIEC_E16_INDEX_URL
      ? new Response(indexHtml(), { headers: { "content-type": "text/html" } })
      : new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).slice(), {
          headers: { "content-type": "application/zip" },
        });
  };
  const releases = await listFfiecE16Releases({ fetch: fetcher });
  expect(releases[0]?.url).toBe(LATEST_URL);
  const error = await captureError(fetchFfiecE16Release(releaseEntry("xlsx"), { fetch: fetcher }));
  expect(error.message).toBe("FFIEC E.16 release has an unexpected workbook structure");
  expect(error.message).not.toContain("PK");
});
