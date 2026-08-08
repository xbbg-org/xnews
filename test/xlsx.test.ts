import { expect, test } from "bun:test";
import { excelSerialDateToIso, readXlsx } from "../src/xlsx.js";

interface ZipFixtureEntry {
  readonly name: string;
  readonly text: string;
}

function buildStoredZip(entries: readonly ZipFixtureEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
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

const WORKSHEET_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

function workbookFixture(): Uint8Array {
  return buildStoredZip([
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0"?><workbook xmlns:r="urn:r"><sheets>
        <sheet name="Second" sheetId="2" r:id="rId2"/>
        <sheet name="First" sheetId="1" r:id="rId1"/>
      </sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<Relationships>
        <Relationship Id="rId1" Type="${WORKSHEET_RELATIONSHIP}" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="${WORKSHEET_RELATIONSHIP}" Target="worksheets/sheet2.xml"/>
      </Relationships>`,
    },
    {
      name: "xl/sharedStrings.xml",
      text: `<sst count="1" uniqueCount="1"><si>
        <r><t xml:space="preserve">Statistical Release </t></r>
        <r><rPr><b/></rPr><t>E.16 (126)</t></r>
      </si></sst>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      text: `<worksheet><sheetData><row r="1">
        <c r="B1" t="s"><v>0</v></c>
        <c r="D1" t="inlineStr"><is><r><t>Inline</t></r><r><t xml:space="preserve"> String</t></r></is></c>
        <c r="E1" t="str"><f>TEXT(1)</f><v>Cached formula</v></c>
        <c r="F1"><v>42.5</v></c>
        <c r="G1" t="b"><v>1</v></c>
        <c r="AA1"><v>99</v></c>
      </row></sheetData></worksheet>`,
    },
    {
      name: "xl/worksheets/sheet2.xml",
      text: `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet</t></is></c></row></sheetData></worksheet>`,
    },
  ]);
}

test("XLSX reader resolves workbook order and preserves dense cell positions", async () => {
  const workbook = await readXlsx(workbookFixture(), "fixture workbook");
  expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(["Second", "First"]);
  expect(workbook.sheets[0]?.rows[0]?.[0]).toBe("Second sheet");

  const first = workbook.sheets[1];
  expect(first?.rows[0]?.[0]).toBeUndefined();
  expect(first?.rows[0]?.[1]).toBe("Statistical Release E.16 (126)");
  expect(first?.rows[0]?.[2]).toBeUndefined();
  expect(first?.rows[0]?.[3]).toBe("Inline String");
  expect(first?.rows[0]?.[4]).toBe("Cached formula");
  expect(first?.rows[0]?.[5]).toBe(42.5);
  expect(first?.rows[0]?.[6]).toBe(true);
  expect(first?.rows[0]?.[26]).toBe(99);
  expect(first?.cells[0]?.[1]?.raw).toBe("Statistical Release E.16 (126)");
  expect(first?.cells[0]?.[26]?.reference).toBe("AA1");
});

test("XLSX reader handles a hand-trimmed real E.16 cover sheet", async () => {
  // The B-starting dimension, rich strings, and B7/D7 cells are copied from the live workbook.
  const archive = buildStoredZip([
    {
      name: "xl/workbook.xml",
      text: `<workbook xmlns:r="urn:r"><sheets><sheet name="E16_009" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<Relationships><Relationship Id="rId1" Type="${WORKSHEET_RELATIONSHIP}" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/sharedStrings.xml",
      text: `<sst count="2040" uniqueCount="187">
        <si><r><t xml:space="preserve">Statistical Release </t></r><r><rPr><b/><sz val="9"/></rPr><t xml:space="preserve">      E.16 (126)</t></r></si>
        <si><r><t xml:space="preserve">Period: </t></r><r><rPr><b/><sz val="16"/></rPr><t>March 31, 2026</t></r></si>
      </sst>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      text: `<worksheet><dimension ref="B1:E10"/><sheetData>
        <row r="1"/><row r="2"/><row r="3"/><row r="4"/><row r="5"/><row r="6"/>
        <row r="7"><c r="B7" t="s"><v>0</v></c><c r="D7" t="s"><v>1</v></c></row>
      </sheetData></worksheet>`,
    },
  ]);
  const workbook = await readXlsx(archive, "trimmed E.16 workbook");
  expect(workbook.sheets[0]?.rows[6]?.[0]).toBeUndefined();
  expect(workbook.sheets[0]?.rows[6]?.[1]).toBe("Statistical Release       E.16 (126)");
  expect(workbook.sheets[0]?.rows[6]?.[2]).toBeUndefined();
  expect(workbook.sheets[0]?.rows[6]?.[3]).toBe("Period: March 31, 2026");
});

test("XLSX reader fails closed when the workbook part is missing", async () => {
  const error = await captureError(
    readXlsx(buildStoredZip([{ name: "placeholder.xml", text: "<placeholder/>" }]), "broken XLSX"),
  );
  expect(error.message).toContain("missing xl/workbook.xml");
});

test("XLSX reader fails closed on an unresolvable sheet relationship", async () => {
  const archive = buildStoredZip([
    {
      name: "xl/workbook.xml",
      text: `<workbook xmlns:r="urn:r"><sheets><sheet name="Lost" r:id="rId1"/></sheets></workbook>`,
    },
    { name: "xl/_rels/workbook.xml.rels", text: "<Relationships/>" },
  ]);
  const error = await captureError(readXlsx(archive, "broken XLSX"));
  expect(error.message).toContain("cannot resolve worksheet relationship rId1");
});

test("XLSX reader fails closed on malformed worksheet XML", async () => {
  const archive = buildStoredZip([
    {
      name: "xl/workbook.xml",
      text: `<workbook xmlns:r="urn:r"><sheets><sheet name="Broken" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<Relationships><Relationship Id="rId1" Type="${WORKSHEET_RELATIONSHIP}" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      text: `<worksheet><sheetData><row r="1"></sheetData></worksheet>`,
    },
  ]);
  const error = await captureError(readXlsx(archive, "broken XLSX"));
  expect(error.message).toContain("malformed XML in xl/worksheets/sheet1.xml");
});

test("Excel serial helper follows the 1900 date system without inventing leap day", () => {
  expect(excelSerialDateToIso(1)).toBe("1900-01-01");
  expect(excelSerialDateToIso(59.75)).toBe("1900-02-28");
  expect(excelSerialDateToIso(61)).toBe("1900-03-01");
  expect(() => excelSerialDateToIso(60)).toThrow("fictitious date");
});
