/**
 * Minimal SpreadsheetML reader for provider workbooks. XLSX date cells remain
 * numeric because interpreting styles would require spreadsheet semantics that
 * structured-data callers should opt into explicitly.
 */

import { decodeEntities } from "./text.js";
import { assertXmlEnvelope, matchXmlBlocks, readXmlAttribute, readXmlTag } from "./xml.js";
import { readZipEntries } from "./zip.js";

export type XlsxCellValue = string | number | boolean | undefined;

/** One populated XLSX cell, including its decoded text before numeric coercion. */
export interface XlsxCell {
  readonly reference: string;
  readonly raw: string;
  readonly value: XlsxCellValue;
}

export interface XlsxSheet {
  readonly name: string;
  /** Rows and columns are zero-based and dense; missing cells remain `undefined`. */
  readonly rows: readonly (readonly XlsxCellValue[])[];
  /** Cell metadata mirrors `rows`, preserving each source reference and raw text. */
  readonly cells: readonly (readonly (XlsxCell | undefined)[])[];
}

export interface XlsxWorkbook {
  readonly sheets: readonly XlsxSheet[];
}

const WORKBOOK_PART = "xl/workbook.xml";
const WORKBOOK_RELATIONSHIPS_PART = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS_PART = "xl/sharedStrings.xml";
const WORKSHEET_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const MAX_XLSX_COLUMN = 16_384;
const MAX_XLSX_ROW = 1_048_576;
const MAX_EXCEL_SERIAL = 2_958_465;
const decoder = new TextDecoder("utf-8", { fatal: true });

interface XmlElement {
  readonly openingTag: string;
  readonly body: string;
}

interface WorkbookSheet {
  readonly name: string;
  readonly relationshipId: string;
}

/**
 * Reads workbook sheets in the order declared by `xl/workbook.xml`. Formulas
 * use their cached `<v>` value; styles, charts, and formula evaluation are out
 * of scope. Date-formatted cells therefore remain Excel serial numbers.
 */
export async function readXlsx(
  archive: Uint8Array,
  label = "XLSX workbook",
): Promise<XlsxWorkbook> {
  let zipEntries;
  try {
    zipEntries = await readZipEntries(archive, label);
  } catch {
    throw new Error(`${label} is not a readable XLSX archive`);
  }

  const parts = new Map<string, Uint8Array>();
  for (const entry of zipEntries) {
    if (parts.has(entry.name)) throw new Error(`${label} contains a duplicate part`);
    parts.set(entry.name, entry.bytes);
  }

  const workbookXml = requiredXmlPart(parts, WORKBOOK_PART, "workbook", label);
  const relationshipsXml = requiredXmlPart(
    parts,
    WORKBOOK_RELATIONSHIPS_PART,
    "Relationships",
    label,
  );
  const workbookSheets = parseWorkbookSheets(workbookXml, label);
  const relationships = parseWorkbookRelationships(relationshipsXml, label);
  const sharedStrings = parseSharedStrings(parts, label);
  const sheets: XlsxSheet[] = [];

  for (const workbookSheet of workbookSheets) {
    const target = relationships.get(workbookSheet.relationshipId);
    const partName = target === undefined ? undefined : resolveWorkbookTarget(target);
    if (partName === undefined || !parts.has(partName)) {
      throw new Error(
        `${label} cannot resolve worksheet relationship ${workbookSheet.relationshipId}`,
      );
    }
    const worksheetXml = requiredXmlPart(parts, partName, "worksheet", label);
    sheets.push(parseWorksheet(worksheetXml, workbookSheet.name, sharedStrings, label));
  }

  return { sheets };
}

/**
 * Converts an Excel 1900-system serial to an ISO calendar date. Fractional
 * time is discarded, and serial 60 is rejected because it denotes Excel's
 * fictitious 1900-02-29 compatibility date.
 */
export function excelSerialDateToIso(serial: number): string {
  if (!Number.isFinite(serial) || serial < 0 || serial > MAX_EXCEL_SERIAL) {
    throw new RangeError("Excel serial date is outside the supported 1900 date system");
  }
  const day = Math.floor(serial);
  if (day === 60) throw new RangeError("Excel serial 60 is the fictitious date 1900-02-29");
  const adjustedDay = day < 60 ? day : day - 1;
  const timestamp = Date.UTC(1899, 11, 31) + adjustedDay * 86_400_000;
  const date = new Date(timestamp);
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const calendarDay = date.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${calendarDay}`;
}

function requiredXmlPart(
  parts: ReadonlyMap<string, Uint8Array>,
  partName: string,
  rootName: string,
  label: string,
): string {
  const bytes = parts.get(partName);
  if (bytes === undefined) throw new Error(`${label} is missing ${partName}`);
  let xml: string;
  try {
    xml = decoder.decode(bytes);
    assertXmlEnvelope(xml, [rootName], `${partName} is malformed XML`);
  } catch {
    throw new Error(`${label} has malformed XML in ${partName}`);
  }
  return xml;
}

function parseWorkbookSheets(xml: string, label: string): readonly WorkbookSheet[] {
  const elements = xmlElements(xml, "sheet");
  if (elements.length === 0) throw new Error(`${label} declares no worksheets`);
  const seenNames = new Set<string>();
  const sheets: WorkbookSheet[] = [];
  for (const element of elements) {
    const name = decodedAttribute(element.openingTag, "sheet", "name");
    const relationshipId = decodedAttribute(element.openingTag, "sheet", "id");
    if (!name || !relationshipId || seenNames.has(name)) {
      throw new Error(`${label} has a malformed worksheet declaration`);
    }
    seenNames.add(name);
    sheets.push({ name, relationshipId });
  }
  return sheets;
}

function parseWorkbookRelationships(xml: string, label: string): ReadonlyMap<string, string> {
  const relationships = new Map<string, string>();
  for (const element of xmlElements(xml, "Relationship")) {
    const id = decodedAttribute(element.openingTag, "Relationship", "Id");
    const type = decodedAttribute(element.openingTag, "Relationship", "Type");
    if (type !== WORKSHEET_RELATIONSHIP) continue;
    const target = decodedAttribute(element.openingTag, "Relationship", "Target");
    const targetMode = decodedAttribute(element.openingTag, "Relationship", "TargetMode");
    if (!id || !target || targetMode || relationships.has(id)) {
      throw new Error(`${label} has a malformed worksheet relationship`);
    }
    relationships.set(id, target);
  }
  return relationships;
}

function parseSharedStrings(
  parts: ReadonlyMap<string, Uint8Array>,
  label: string,
): readonly string[] {
  if (!parts.has(SHARED_STRINGS_PART)) return [];
  const xml = requiredXmlPart(parts, SHARED_STRINGS_PART, "sst", label);
  return xmlElements(xml, "si").map((element) => richText(element.body, label));
}

function parseWorksheet(
  xml: string,
  name: string,
  sharedStrings: readonly string[],
  label: string,
): XlsxSheet {
  const rows: XlsxCellValue[][] = [];
  const cells: (XlsxCell | undefined)[][] = [];
  let previousRow = 0;

  for (const rowElement of xmlElements(xml, "row")) {
    const rowText = decodedAttribute(rowElement.openingTag, "row", "r");
    const rowNumber = Number(rowText);
    if (!Number.isSafeInteger(rowNumber) || rowNumber <= previousRow || rowNumber > MAX_XLSX_ROW) {
      throw new Error(`${label} has a malformed row reference in worksheet ${name}`);
    }
    while (rows.length < rowNumber) rows.push([]);
    while (cells.length < rowNumber) cells.push([]);
    const row = rows[rowNumber - 1];
    const cellRow = cells[rowNumber - 1];
    if (row === undefined || cellRow === undefined) {
      throw new Error(`${label} has a malformed row reference in worksheet ${name}`);
    }

    let previousColumn = -1;
    for (const cellElement of xmlElements(rowElement.body, "c")) {
      const reference = decodedAttribute(cellElement.openingTag, "c", "r");
      const parsedReference = parseCellReference(reference);
      if (
        parsedReference === undefined ||
        parsedReference.row !== rowNumber ||
        parsedReference.column <= previousColumn
      ) {
        throw new Error(`${label} has a malformed cell reference in worksheet ${name}`);
      }
      previousColumn = parsedReference.column;
      while (row.length <= parsedReference.column) row.push(undefined);
      while (cellRow.length <= parsedReference.column) cellRow.push(undefined);
      const cell = parseCell(cellElement, reference, sharedStrings, label, name);
      row[parsedReference.column] = cell.value;
      cellRow[parsedReference.column] = cell;
    }
    previousRow = rowNumber;
  }

  return { name, rows, cells };
}

function parseCell(
  element: XmlElement,
  reference: string,
  sharedStrings: readonly string[],
  label: string,
  sheetName: string,
): XlsxCell {
  const type = decodedAttribute(element.openingTag, "c", "t");
  if (type === "inlineStr") {
    const inlineString = readXmlTag(element.body, "is");
    const value = richText(inlineString, label);
    return { reference, raw: value, value };
  }

  const hasValue = xmlElements(element.body, "v").length > 0;
  const raw = hasValue ? decodedText(readXmlTag(element.body, "v"), label) : "";
  if (!hasValue) return { reference, raw, value: undefined };

  if (type === "s") {
    const index = Number(raw);
    const value = Number.isSafeInteger(index) && index >= 0 ? sharedStrings[index] : undefined;
    if (value === undefined) {
      throw new Error(`${label} has an invalid shared string in worksheet ${sheetName}`);
    }
    return { reference, raw: value, value };
  }
  if (type === "b") {
    if (raw === "1") return { reference, raw, value: true };
    if (raw === "0") return { reference, raw, value: false };
    throw new Error(`${label} has an invalid boolean in worksheet ${sheetName}`);
  }
  if (type === "str" || type === "e" || type === "d") {
    return { reference, raw, value: raw };
  }
  if (type && type !== "n") {
    throw new Error(`${label} has an unsupported cell type in worksheet ${sheetName}`);
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${label} has an invalid number in worksheet ${sheetName}`);
  }
  return { reference, raw, value };
}

function richText(xml: string, label: string): string {
  const textElements = xmlElements(xml, "t");
  if (textElements.length === 0) return "";
  return textElements.map((element) => decodedText(element.body, label)).join("");
}

function decodedText(value: string, label: string): string {
  if (value.includes("<")) throw new Error(`${label} contains malformed spreadsheet text`);
  const decoded = decodeEntities(value);
  if (/&(?:#x?[\dA-Fa-f]+|[A-Za-z]+);/.test(decoded)) {
    throw new Error(`${label} contains an unsupported XML entity`);
  }
  return decoded;
}

function decodedAttribute(xml: string, element: string, attribute: string): string {
  return decodeEntities(readXmlAttribute(xml, element, attribute));
}

function xmlElements(xml: string, localName: string): readonly XmlElement[] {
  const escapedName = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openingPattern = new RegExp(`<(?:[\\w.-]+:)?${escapedName}(?=[\\s/>])[^>]*>`, "gi");
  const openings = Array.from(xml.matchAll(openingPattern), (match) => match[0] ?? "");
  const bodies = Array.from(matchXmlBlocks(xml, localName));
  if (openings.length !== bodies.length) return [];
  return openings.map((openingTag, index) => ({ openingTag, body: bodies[index] ?? "" }));
}

function resolveWorkbookTarget(target: string): string | undefined {
  let resolved: URL;
  try {
    resolved = new URL(target, "https://xlsx.invalid/xl/workbook.xml");
  } catch {
    return undefined;
  }
  if (resolved.origin !== "https://xlsx.invalid") return undefined;
  try {
    return decodeURIComponent(resolved.pathname.slice(1));
  } catch {
    return undefined;
  }
}

function parseCellReference(
  reference: string,
): { readonly column: number; readonly row: number } | undefined {
  const match = /^([A-Za-z]+)([1-9]\d*)$/.exec(reference);
  if (match === null) return undefined;
  const letters = match[1];
  if (letters === undefined) return undefined;
  let oneBasedColumn = 0;
  for (const character of letters.toUpperCase()) {
    oneBasedColumn = oneBasedColumn * 26 + character.charCodeAt(0) - 64;
    if (oneBasedColumn > MAX_XLSX_COLUMN) return undefined;
  }
  const row = Number(match[2]);
  if (!Number.isSafeInteger(row) || row > MAX_XLSX_ROW) return undefined;
  return { column: oneBasedColumn - 1, row };
}
