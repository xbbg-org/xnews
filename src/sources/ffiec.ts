import { parsePublishedAt } from "../dates.js";
import { BROWSERISH_USER_AGENT, fetchRaw, postForm, type RawFetchResult } from "../http.js";
import { normalizeLimit } from "../options.js";
import { decodeEntities, stableId, stripAsciiControlCharacters } from "../text.js";
import { readZipEntries } from "../zip.js";
import {
  FFIEC_BULK_PERIOD_FIELD,
  FFIEC_BULK_PRODUCT_FIELD,
  FFIEC_CDR_BULK_DATA_URL,
  ffiecBulkDownloadForm,
  ffiecBulkFormatSelectForm,
  ffiecBulkPeriodSelectForm,
  ffiecBulkProductDefinition,
  ffiecBulkProductSelectForm,
  ffiecReportingPeriodDate,
  findFfiecReportingPeriod,
} from "./ffiec.urls.js";
import type { FfiecBulkFormat, FfiecBulkProduct, FfiecReportingPeriod } from "./ffiec.urls.js";
import type {
  DataFetchOptions,
  DataRelease,
  DataSource,
  NewsItem,
  SourceFetchOptions,
} from "../types.js";

export {
  FFIEC_BULK_DOWNLOAD_FIELD,
  FFIEC_BULK_FORMAT_FIELD,
  FFIEC_BULK_PERIOD_FIELD,
  FFIEC_BULK_PRODUCT_FIELD,
  FFIEC_BULK_PRODUCTS,
  FFIEC_CDR_BULK_DATA_URL,
  ffiecBulkDownloadForm,
  ffiecBulkFormatSelectForm,
  ffiecBulkPeriodSelectForm,
  ffiecBulkProductDefinition,
  ffiecBulkProductSelectForm,
  ffiecReportingPeriodDate,
  ffiecReportingPeriodMatches,
  findFfiecReportingPeriod,
} from "./ffiec.urls.js";
export type {
  FfiecBulkFormat,
  FfiecBulkProduct,
  FfiecBulkProductDefinition,
  FfiecBundleKind,
  FfiecReportingPeriod,
} from "./ffiec.urls.js";

/** Parsed state of the CDR bulk download page after any postback. */
export interface FfiecBulkPage {
  /** Hidden ASP.NET form fields to echo back on the next postback. */
  readonly hiddenFields: Readonly<Record<string, string>>;
  readonly products: readonly { readonly formValue: string; readonly label: string }[];
  /** Populated only after a product has been selected. */
  readonly periods: readonly FfiecReportingPeriod[];
  /** ISO date of the page's "Call Updated" stamp, when shown. */
  readonly callUpdated?: string;
  /** ISO date of the page's "UBPR Updated" stamp, when shown. */
  readonly ubprUpdated?: string;
}

const INPUT_TAG = /<input\b[^>]*>/gi;
const SELECT_BLOCK = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
const OPTION_TAG = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
const UPDATED_STAMP = /\b(Call|UBPR)\s+Updated:\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi;

function attributeValue(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!match) return undefined;
  return match[2] ?? match[3] ?? match[4] ?? "";
}

function usDateToIso(value: string): string | undefined {
  return ffiecReportingPeriodDate({ formValue: "", label: value.trim() });
}

/** Parses the CDR bulk download page markup. Pure and network-free. */
export function parseFfiecBulkPage(html: string): FfiecBulkPage {
  const hiddenFields: Record<string, string> = {};
  for (const match of html.matchAll(INPUT_TAG)) {
    const tag = match[0];
    if ((attributeValue(tag, "type") ?? "").toLowerCase() !== "hidden") continue;
    const name = attributeValue(tag, "name");
    if (name) hiddenFields[name] = decodeEntities(attributeValue(tag, "value") ?? "");
  }

  const products: { formValue: string; label: string }[] = [];
  const periods: FfiecReportingPeriod[] = [];
  for (const select of html.matchAll(SELECT_BLOCK)) {
    const attrs = select[1] ?? "";
    const name = attributeValue(`<select${attrs}>`, "name");
    const id = attributeValue(`<select${attrs}>`, "id");
    const isProducts = name === FFIEC_BULK_PRODUCT_FIELD || id === "ListBox1";
    const isPeriods = name === FFIEC_BULK_PERIOD_FIELD || id === "DatesDropDownList";
    if (!isProducts && !isPeriods) continue;

    for (const option of (select[2] ?? "").matchAll(OPTION_TAG)) {
      const formValue = decodeEntities(attributeValue(`<option${option[1] ?? ""}>`, "value") ?? "");
      const label = decodeEntities(option[2] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!formValue && !label) continue;
      if (isProducts) products.push({ formValue, label });
      else periods.push({ formValue, label });
    }
  }

  let callUpdated: string | undefined;
  let ubprUpdated: string | undefined;
  for (const match of html.matchAll(UPDATED_STAMP)) {
    const iso = usDateToIso(match[2] ?? "");
    if (iso === undefined) continue;
    if (match[1]?.toLowerCase() === "call") callUpdated ??= iso;
    else ubprUpdated ??= iso;
  }

  return {
    hiddenFields,
    products,
    periods,
    ...(callUpdated ? { callUpdated } : {}),
    ...(ubprUpdated ? { ubprUpdated } : {}),
  };
}

// --------------------------------------------------------------------------
// Bulk TSV bundles
// --------------------------------------------------------------------------

/** One filer's identity row from the bulk POR file. */
export interface FfiecInstitution {
  readonly rssdId: number;
  readonly fdicCert?: number;
  readonly occCharter?: number;
  readonly otsDocket?: number;
  readonly abaRouting?: number;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly state: string;
  readonly zipCode: string;
  readonly filingType: string;
  /** Verbatim "Last Date/Time Submission Updated On" value, when present. */
  readonly lastUpdated?: string;
}

export interface FfiecScheduleColumn {
  /** MDRM item code, e.g. `RCON2170`. */
  readonly mdrm: string;
  readonly description: string;
}

/** One filer's non-empty items on one schedule. */
export interface FfiecScheduleFacts {
  readonly rssdId: number;
  readonly values: Readonly<Record<string, string>>;
}

export interface FfiecSchedule {
  /** Schedule code from the bulk filename, e.g. `RC`, `RCRI`, `ENT`. */
  readonly code: string;
  readonly columns: readonly FfiecScheduleColumn[];
  readonly facts: readonly FfiecScheduleFacts[];
}

/** A single-period "Call Reports" bulk TSV archive, fully parsed. */
export interface FfiecCallBundle {
  /** ISO reporting period end date from the bulk filenames. */
  readonly periodEnd: string;
  readonly readme: string;
  readonly institutions: readonly FfiecInstitution[];
  readonly schedules: readonly FfiecSchedule[];
}

/** One filer-period observation from the four-period subset bulk file. */
export interface FfiecFourPeriodFiling {
  readonly rssdId: number;
  /** ISO reporting period end date. */
  readonly periodEnd: string;
  readonly institution: FfiecInstitution;
  readonly values: Readonly<Record<string, string>>;
}

/** A "Call Reports -- Four Periods" subset bulk TSV archive. */
export interface FfiecFourPeriodBundle {
  /** Four-digit label from the bulk filename (the publication year). */
  readonly periodLabel: string;
  readonly readme: string;
  readonly columns: readonly FfiecScheduleColumn[];
  readonly filings: readonly FfiecFourPeriodFiling[];
}

export interface FfiecUbprColumn {
  readonly mdrm: string;
  readonly mnemonic: string;
  readonly description: string;
}

/** One filer-period (or peer-group) observation from a UBPR bulk report. */
export interface FfiecUbprFiling {
  /** ISO reporting period end date. */
  readonly periodEnd: string;
  readonly rssdId?: number;
  readonly peerGroup?: string;
  readonly peerGroupDescription?: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface FfiecUbprReport {
  readonly name: string;
  readonly kind: FfiecUbprKind;
  readonly columns: readonly FfiecUbprColumn[];
  readonly filings: readonly FfiecUbprFiling[];
}

export type FfiecUbprKind = "ratios" | "ranks" | "stats";

/** A UBPR ratios, ranks, or stats bulk TSV archive. */
export interface FfiecUbprBundle {
  readonly year: string;
  readonly kind: FfiecUbprKind;
  readonly readme: string;
  readonly reports: readonly FfiecUbprReport[];
}

const SCHEDULE_FILE =
  /^FFIEC\s+CDR\s+Call\s+(Bulk\s+POR|Schedule\s+([A-Z0-9]+))\s+(\d{8})(?:\((\d+)\s+of\s+\d+\))?\.txt$/i;
const FOUR_PERIOD_FILE =
  /^FFIEC\s+CDR\s+Call\s+Subset\s+of\s+Schedules\s+(\d{4})(?:\((\d+)\s+of\s+\d+\))?\.txt$/i;
const UBPR_FILE = /^FFIEC\s+CDR\s+UBPR\s+(Ratios|Ranks|Stats)\s+(.+)\s+(\d{4})\.txt$/i;
const UBPR_KINDS: Record<string, FfiecUbprKind> = {
  ratios: "ratios",
  ranks: "ranks",
  stats: "stats",
};
const README_NAME = "readme.txt";
const POR_METADATA_COLUMNS = [
  "Reporting Period End Date",
  "IDRSSD",
  "FDIC Certificate Number",
  "OCC Charter Number",
  "OTS Docket Number",
  "Primary ABA Routing Number",
  "Financial Institution Name",
  "Financial Institution Address",
  "Financial Institution City",
  "Financial Institution State",
  "Financial Institution Zip Code",
  "Financial Institution Filing Type",
  "Last Date/Time Submission Updated On",
] as const;

const entryDecoder = new TextDecoder();

/**
 * Parses a single-period "Call Reports" bulk TSV archive: the POR
 * institution roster plus every schedule file, with split parts merged.
 */
export async function parseFfiecCallBundle(archive: Uint8Array): Promise<FfiecCallBundle> {
  let readme = "";
  let periodEnd: string | undefined;
  let porText: string | undefined;
  const scheduleParts = new Map<string, { part: number; text: string }[]>();

  for (const entry of await readZipEntries(archive, "FFIEC bulk archive")) {
    if (entry.name.toLowerCase() === README_NAME) {
      readme = entryDecoder.decode(entry.bytes);
      continue;
    }
    const match = SCHEDULE_FILE.exec(entry.name);
    if (!match) continue;
    periodEnd = mmddyyyyToIso(match[3] ?? "") ?? periodEnd;
    if ((match[1] ?? "").toLowerCase().startsWith("bulk por")) {
      porText = entryDecoder.decode(entry.bytes);
      continue;
    }
    const code = (match[2] ?? "").toUpperCase();
    const parts = scheduleParts.get(code) ?? [];
    parts.push({ part: Number(match[4] ?? "1"), text: entryDecoder.decode(entry.bytes) });
    scheduleParts.set(code, parts);
  }

  if (periodEnd === undefined) {
    throw new Error("Archive does not contain any FFIEC schedule files");
  }
  if (porText === undefined) {
    throw new Error("Archive does not contain the Bulk POR institution file");
  }

  const schedules = [...scheduleParts.entries()].map(([code, parts]) =>
    parseSchedule(
      code,
      parts.toSorted((a, b) => a.part - b.part),
    ),
  );
  return { periodEnd, readme, institutions: parseInstitutions(porText), schedules };
}

/** Parses a "Call Reports -- Four Periods" subset bulk TSV archive. */
export async function parseFfiecFourPeriodBundle(
  archive: Uint8Array,
): Promise<FfiecFourPeriodBundle> {
  let readme = "";
  let periodLabel = "";
  const parts: { part: number; text: string }[] = [];

  for (const entry of await readZipEntries(archive, "FFIEC bulk archive")) {
    if (entry.name.toLowerCase() === README_NAME) {
      readme = entryDecoder.decode(entry.bytes);
      continue;
    }
    const match = FOUR_PERIOD_FILE.exec(entry.name);
    if (!match) continue;
    periodLabel = match[1] ?? periodLabel;
    parts.push({ part: Number(match[2] ?? "1"), text: entryDecoder.decode(entry.bytes) });
  }
  if (parts.length === 0) {
    throw new Error("Archive does not contain four-period subset files");
  }

  const columns: FfiecScheduleColumn[] = [];
  const seenMdrms = new Set<string>();
  const filings = new Map<
    string,
    { institution: FfiecInstitution; values: Record<string, string> }
  >();

  for (const { text } of parts.toSorted((a, b) => a.part - b.part)) {
    const rows = parseTsvRows(text);
    const header = stripTrailingBlank(cleanHeader(rows[0] ?? []));
    const descriptions = stripTrailingBlank(cleanHeader(rows[1] ?? []));
    const metadata = new Map<string, number>();
    for (const column of POR_METADATA_COLUMNS) {
      const index = header.indexOf(column);
      if (index !== -1) metadata.set(column, index);
    }
    const rssdIndex = metadata.get("IDRSSD");
    const periodIndex = metadata.get("Reporting Period End Date");
    if (rssdIndex === undefined || periodIndex === undefined) {
      throw new Error("Four-period file is missing required metadata columns");
    }

    const mdrmIndices: { index: number; mdrm: string }[] = [];
    for (const [index, column] of header.entries()) {
      if (!column || (POR_METADATA_COLUMNS as readonly string[]).includes(column)) continue;
      mdrmIndices.push({ index, mdrm: column });
      if (!seenMdrms.has(column)) {
        seenMdrms.add(column);
        columns.push({ mdrm: column, description: (descriptions[index] ?? "").trim() });
      }
    }

    for (const row of rows.slice(2)) {
      if (row.every((cell) => cell === "")) continue;
      const rssdId = parseIntOrUndefined(row[rssdIndex]);
      if (rssdId === undefined) continue;
      const periodEnd = row[periodIndex]?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) continue;

      const key = `${rssdId}|${periodEnd}`;
      let bucket = filings.get(key);
      if (bucket === undefined) {
        bucket = { institution: institutionFromRow(row, metadata, rssdId), values: {} };
        filings.set(key, bucket);
      }
      for (const { index, mdrm } of mdrmIndices) {
        if (index >= row.length) break;
        const value = row[index] ?? "";
        if (value) bucket.values[mdrm] = value;
      }
    }
  }

  return {
    periodLabel,
    readme,
    columns,
    filings: [...filings.entries()].map(([key, bucket]) => {
      const [rssdText = "", periodEnd = ""] = key.split("|");
      return {
        rssdId: Number(rssdText),
        periodEnd,
        institution: bucket.institution,
        values: bucket.values,
      };
    }),
  };
}

/** Parses a UBPR ratios, ranks, or stats bulk TSV archive. */
export async function parseFfiecUbprBundle(archive: Uint8Array): Promise<FfiecUbprBundle> {
  let readme = "";
  const files: { kind: FfiecUbprKind; report: string; year: string; text: string }[] = [];

  for (const entry of await readZipEntries(archive, "FFIEC bulk archive")) {
    if (entry.name.toLowerCase() === README_NAME) {
      readme = entryDecoder.decode(entry.bytes);
      continue;
    }
    const match = UBPR_FILE.exec(entry.name);
    if (!match) continue;
    const kind = UBPR_KINDS[(match[1] ?? "").toLowerCase()];
    if (kind === undefined) continue;
    files.push({
      kind,
      report: (match[2] ?? "").trim(),
      year: match[3] ?? "",
      text: entryDecoder.decode(entry.bytes),
    });
  }
  if (files.length === 0) {
    throw new Error("Archive does not contain UBPR bulk files");
  }

  const kind = files[0]!.kind;
  const year = files[0]!.year;
  const reports = files
    .filter((file) => file.kind === kind && file.year === year)
    .map((file) => parseUbprReport(file.report, kind, file.text));
  return { year, kind, readme, reports };
}

function parseInstitutions(text: string): readonly FfiecInstitution[] {
  const rows = parseTsvRows(text);
  const header = stripTrailingBlank(cleanHeader(rows[0] ?? []));
  const lookup = new Map<string, number>(header.map((column, index) => [column, index]));
  const institutions: FfiecInstitution[] = [];
  for (const row of rows.slice(1)) {
    if (row.every((cell) => cell === "")) continue;
    const rssdId = parseIntOrUndefined(row[lookup.get("IDRSSD") ?? -1]);
    if (rssdId === undefined) continue;
    institutions.push(institutionFromRow(row, lookup, rssdId));
  }
  return institutions;
}

function institutionFromRow(
  row: readonly string[],
  lookup: ReadonlyMap<string, number>,
  rssdId: number,
): FfiecInstitution {
  const cell = (column: string): string => {
    const index = lookup.get(column);
    return index === undefined ? "" : (row[index] ?? "");
  };
  const fdicCert = parseIntOrUndefined(cell("FDIC Certificate Number"));
  const occCharter = parseIntOrUndefined(cell("OCC Charter Number"));
  const otsDocket = parseIntOrUndefined(cell("OTS Docket Number"));
  const abaRouting = parseIntOrUndefined(cell("Primary ABA Routing Number"));
  const lastUpdated = cell("Last Date/Time Submission Updated On").trim();
  return {
    rssdId,
    ...(fdicCert === undefined ? {} : { fdicCert }),
    ...(occCharter === undefined ? {} : { occCharter }),
    ...(otsDocket === undefined ? {} : { otsDocket }),
    ...(abaRouting === undefined ? {} : { abaRouting }),
    name: cell("Financial Institution Name").trim(),
    address: cell("Financial Institution Address").trim(),
    city: cell("Financial Institution City").trim(),
    state: cell("Financial Institution State").trim(),
    zipCode: cell("Financial Institution Zip Code").trim(),
    filingType: cell("Financial Institution Filing Type").trim(),
    ...(lastUpdated === "" ? {} : { lastUpdated }),
  };
}

function parseSchedule(
  code: string,
  parts: readonly { part: number; text: string }[],
): FfiecSchedule {
  const columns: FfiecScheduleColumn[] = [];
  const seenMdrms = new Set<string>();
  const factsByRssd = new Map<number, Record<string, string>>();

  for (const { text } of parts) {
    const rows = parseTsvRows(text);
    const header = stripTrailingBlank(cleanHeader(rows[0] ?? []));
    const descriptions = stripTrailingBlank(cleanHeader(rows[1] ?? []));
    if ((header[0] ?? "").toUpperCase() !== "IDRSSD") {
      throw new Error(`Schedule ${code} file does not start with an IDRSSD column`);
    }

    for (let index = 1; index < header.length; index += 1) {
      const mdrm = header[index] ?? "";
      if (seenMdrms.has(mdrm)) continue;
      seenMdrms.add(mdrm);
      columns.push({ mdrm, description: (descriptions[index] ?? "").trim() });
    }

    for (const row of rows.slice(2)) {
      if (row.length === 0 || !row[0]) continue;
      const rssdId = parseIntOrUndefined(row[0]);
      if (rssdId === undefined) continue;
      let bucket = factsByRssd.get(rssdId);
      if (bucket === undefined) {
        bucket = {};
        factsByRssd.set(rssdId, bucket);
      }
      for (let index = 1; index < header.length && index < row.length; index += 1) {
        const value = row[index] ?? "";
        if (value) bucket[header[index] ?? ""] = value;
      }
    }
  }

  return {
    code,
    columns,
    facts: [...factsByRssd.entries()].map(([rssdId, values]) => ({ rssdId, values })),
  };
}

function parseUbprReport(name: string, kind: FfiecUbprKind, text: string): FfiecUbprReport {
  const rows = parseTsvRows(text);
  const header = stripTrailingBlank(cleanHeader(rows[0] ?? []));
  const mnemonics = stripTrailingBlank(cleanHeader(rows[1] ?? []));
  const descriptions = stripTrailingBlank(cleanHeader(rows[2] ?? []));

  const metricStart = header.findIndex((column) => column.toUpperCase().startsWith("UBP"));
  if (metricStart === -1) {
    throw new Error(`UBPR file for ${JSON.stringify(name)} is missing UBPR metric columns`);
  }
  const metadata = new Map<string, number>(
    header.slice(0, metricStart).map((column, index) => [column, index]),
  );
  const periodIndex = metadata.get("Reporting Period");
  if (periodIndex === undefined) {
    throw new Error(`UBPR file for ${JSON.stringify(name)} is missing the Reporting Period column`);
  }

  const columns: FfiecUbprColumn[] = [];
  const metricIndices: { index: number; mdrm: string }[] = [];
  for (let index = metricStart; index < header.length; index += 1) {
    const mdrm = header[index] ?? "";
    if (!mdrm) continue;
    columns.push({
      mdrm,
      mnemonic: (mnemonics[index] ?? "").trim(),
      description: (descriptions[index] ?? "").trim(),
    });
    metricIndices.push({ index, mdrm });
  }

  const filings: FfiecUbprFiling[] = [];
  for (const row of rows.slice(3)) {
    if (row.every((cell) => cell === "")) continue;
    if (periodIndex >= row.length) continue;
    const periodEnd = ubprPeriodToIso(row[periodIndex] ?? "");
    if (periodEnd === undefined) continue;

    const values: Record<string, string> = {};
    for (const { index, mdrm } of metricIndices) {
      if (index >= row.length) break;
      const value = row[index] ?? "";
      if (value) values[mdrm] = value;
    }

    const rssdId = parseIntOrUndefined(row[metadata.get("ID RSSD") ?? -1]?.trim());
    const peerGroup = row[metadata.get("Peer Group") ?? -1]?.trim();
    const peerGroupDescription = row[metadata.get("Peer Group Description") ?? -1]?.trim();
    filings.push({
      periodEnd,
      ...(rssdId === undefined ? {} : { rssdId }),
      ...(peerGroup ? { peerGroup } : {}),
      ...(peerGroupDescription ? { peerGroupDescription } : {}),
      values,
    });
  }

  return { name, kind, columns, filings };
}

/**
 * Splits tab-separated text into rows, honoring double-quoted fields with
 * doubled-quote escapes (the csv "excel-tab" dialect the CDR files use).
 */
export function parseFfiecTsvRows(text: string): string[][] {
  return parseTsvRows(text);
}

function parseTsvRows(text: string): string[][] {
  if (!text.includes('"')) {
    const lines = text.split(/\r\n|\n|\r/);
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.map((line) => line.split("\t"));
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cleanHeader(row: readonly string[]): string[] {
  return row.map((column) => column.trim().replace(/^"|"$/g, ""));
}

function stripTrailingBlank(values: string[]): string[] {
  while (values.length > 0 && values[values.length - 1] === "") values.pop();
  return values;
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) ? parsed : undefined;
}

function mmddyyyyToIso(value: string): string | undefined {
  if (!/^\d{8}$/.test(value)) return undefined;
  return usDateToIso(`${Number(value.slice(0, 2))}/${Number(value.slice(2, 4))}/${value.slice(4)}`);
}

function ubprPeriodToIso(value: string): string | undefined {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)?$/i.exec(
    text,
  );
  if (!match) return undefined;
  return usDateToIso(`${match[1]}/${match[2]}/${match[3]}`);
}

// --------------------------------------------------------------------------
// Transport: the stateful postback chain
// --------------------------------------------------------------------------

interface FfiecBulkSession {
  readonly cookies: Map<string, string>;
}

function applySetCookies(session: FfiecBulkSession, setCookies: readonly string[]): void {
  for (const header of setCookies) {
    const pair = header.split(";", 1)[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    session.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

function bulkRequestHeaders(session: FfiecBulkSession): Record<string, string> {
  const cookie = [...session.cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return {
    Origin: "https://cdr.ffiec.gov",
    Referer: FFIEC_CDR_BULK_DATA_URL,
    ...(cookie === "" ? {} : { Cookie: cookie }),
  };
}

function requireHiddenFields(page: FfiecBulkPage): Readonly<Record<string, string>> {
  const missing = ["__VIEWSTATE", "__VIEWSTATEGENERATOR"].filter(
    (name) => !page.hiddenFields[name],
  );
  if (missing.length > 0) {
    throw new Error(`FFIEC bulk page is missing required hidden field(s): ${missing.join(", ")}`);
  }
  return page.hiddenFields;
}

async function postBulkForm(
  form: Readonly<Record<string, string>>,
  options: SourceFetchOptions,
  session: FfiecBulkSession,
): Promise<RawFetchResult> {
  const result = await postForm(FFIEC_CDR_BULK_DATA_URL, form, options, {
    userAgent: options.userAgent ?? BROWSERISH_USER_AGENT,
    headers: bulkRequestHeaders(session),
  });
  applySetCookies(session, result.setCookies);
  return result;
}

/** Loads the CDR bulk page: products, update stamps, no periods yet. */
export async function fetchFfiecBulkPage(options: SourceFetchOptions = {}): Promise<FfiecBulkPage> {
  const session: FfiecBulkSession = { cookies: new Map() };
  return loadBulkPage(options, session);
}

async function loadBulkPage(
  options: SourceFetchOptions,
  session: FfiecBulkSession,
): Promise<FfiecBulkPage> {
  const result = await fetchRaw(FFIEC_CDR_BULK_DATA_URL, options, {
    userAgent: options.userAgent ?? BROWSERISH_USER_AGENT,
    headers: bulkRequestHeaders(session),
  });
  applySetCookies(session, result.setCookies);
  return parseFfiecBulkPage(entryDecoder.decode(result.bytes));
}

/** Lists the reporting periods the CDR offers for a bulk product. */
export async function fetchFfiecReportingPeriods(
  product: FfiecBulkProduct,
  options: SourceFetchOptions = {},
): Promise<readonly FfiecReportingPeriod[]> {
  const definition = ffiecBulkProductDefinition(product);
  const session: FfiecBulkSession = { cookies: new Map() };
  const page = await loadBulkPage(options, session);
  const selected = await postBulkPage(
    ffiecBulkProductSelectForm(requireHiddenFields(page), definition.product),
    options,
    session,
  );
  if (selected.periods.length === 0) {
    throw new Error(`FFIEC did not return reporting periods for ${definition.label}`);
  }
  return selected.periods;
}

async function postBulkPage(
  form: Readonly<Record<string, string>>,
  options: SourceFetchOptions,
  session: FfiecBulkSession,
): Promise<FfiecBulkPage> {
  const result = await postBulkForm(form, options, session);
  return parseFfiecBulkPage(entryDecoder.decode(result.bytes));
}

export interface FfiecBulkDownloadQuery {
  readonly product: FfiecBulkProduct;
  /**
   * Reporting period as the dropdown label (`03/31/2026`), `YYYYMMDD`, ISO
   * `YYYY-MM-DD`, or the dropdown form value. Defaults to the latest.
   */
  readonly period?: string;
  /** Defaults to the product's CDR default (first supported format). */
  readonly format?: FfiecBulkFormat;
}

export interface FfiecBulkDownload {
  readonly product: FfiecBulkProduct;
  readonly period: FfiecReportingPeriod;
  readonly format: FfiecBulkFormat;
  /** Filename from `Content-Disposition`, sanitized to a bare basename. */
  readonly filename: string;
  readonly contentType?: string;
  readonly bytes: Uint8Array;
  /** ISO date of the page's "Call Updated" stamp, when shown. */
  readonly callUpdated?: string;
  /** ISO date of the page's "UBPR Updated" stamp, when shown. */
  readonly ubprUpdated?: string;
}

/**
 * Downloads one bulk product archive by driving the CDR postback chain:
 * load, select product, select period, select format, download. The bytes
 * are returned, never written to disk.
 */
export async function downloadFfiecBulkData(
  query: FfiecBulkDownloadQuery,
  options: SourceFetchOptions = {},
): Promise<FfiecBulkDownload> {
  const download = await runBulkDownload(query, options);
  // runBulkDownload only skips when a predicate is provided.
  return download!;
}

async function runBulkDownload(
  query: FfiecBulkDownloadQuery,
  options: SourceFetchOptions,
  shouldSkip?: (period: FfiecReportingPeriod) => boolean,
): Promise<FfiecBulkDownload | undefined> {
  const definition = ffiecBulkProductDefinition(query.product);
  const format = query.format ?? definition.formats[0]!;
  const session: FfiecBulkSession = { cookies: new Map() };

  let callUpdated: string | undefined;
  let ubprUpdated: string | undefined;
  const track = (page: FfiecBulkPage): FfiecBulkPage => {
    callUpdated ??= page.callUpdated;
    ubprUpdated ??= page.ubprUpdated;
    return page;
  };

  const landing = track(await loadBulkPage(options, session));
  const productPage = track(
    await postBulkPage(
      ffiecBulkProductSelectForm(requireHiddenFields(landing), definition.product),
      options,
      session,
    ),
  );
  if (productPage.periods.length === 0) {
    throw new Error(`FFIEC did not return reporting periods for ${definition.label}`);
  }

  let period: FfiecReportingPeriod;
  if (query.period === undefined || query.period === "latest") {
    period = productPage.periods[0]!;
  } else {
    const found = findFfiecReportingPeriod(query.period, productPage.periods);
    if (!found) {
      const sample = productPage.periods
        .slice(0, 6)
        .map((candidate) => candidate.label)
        .join(", ");
      throw new RangeError(
        `Reporting period ${JSON.stringify(query.period)} was not found; available periods include: ${sample}`,
      );
    }
    period = found;
  }
  if (shouldSkip?.(period)) return undefined;

  const periodPage = track(
    await postBulkPage(
      ffiecBulkPeriodSelectForm(
        requireHiddenFields(productPage),
        definition.product,
        period.formValue,
      ),
      options,
      session,
    ),
  );
  const formatPage = track(
    await postBulkPage(
      ffiecBulkFormatSelectForm(
        requireHiddenFields(periodPage),
        definition.product,
        period.formValue,
        format,
      ),
      options,
      session,
    ),
  );

  const result = await postBulkForm(
    ffiecBulkDownloadForm(
      requireHiddenFields(formatPage),
      definition.product,
      period.formValue,
      format,
    ),
    options,
    session,
  );
  const contentType = (result.contentType ?? "").toLowerCase();
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    throw new Error("FFIEC returned an HTML page instead of a download");
  }
  const disposition = result.contentDisposition ?? "";
  if (!contentType.startsWith("application/") && !/attachment/i.test(disposition)) {
    throw new Error(
      `FFIEC response did not look like a file: ${result.contentType ?? "unknown content type"}`,
    );
  }

  const filename =
    filenameFromDisposition(disposition) ??
    expectedBulkFilename(definition.product, period, format);
  return {
    product: definition.product,
    period,
    format,
    filename,
    ...(result.contentType === undefined ? {} : { contentType: result.contentType }),
    bytes: result.bytes,
    ...(callUpdated ? { callUpdated } : {}),
    ...(ubprUpdated ? { ubprUpdated } : {}),
  };
}

function filenameFromDisposition(disposition: string): string | undefined {
  const match = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposition);
  const raw = (match?.[1] ?? match?.[2] ?? "").trim();
  if (!raw) return undefined;
  const basename = raw.replaceAll("\\", "/").split("/").pop() ?? "";
  const cleaned = stripAsciiControlCharacters(basename)
    .replace(/[<>:"/\\|?*]/g, "")
    .trim();
  return cleaned === "" ? undefined : cleaned;
}

function expectedBulkFilename(
  product: FfiecBulkProduct,
  period: FfiecReportingPeriod,
  format: FfiecBulkFormat,
): string {
  const periodPart =
    ffiecReportingPeriodDate(period)?.replaceAll("-", "") ?? period.label.replaceAll(/\s+/g, "-");
  return `ffiec-${product}-${periodPart}-${format}.zip`;
}

// --------------------------------------------------------------------------
// Data lane: call reports as a DataSource
// --------------------------------------------------------------------------

/** One filer's non-empty items on one schedule for one reporting period. */
export interface FfiecCallRow {
  readonly rssdId: number;
  /** Institution name from the bulk POR roster, when the filer is listed. */
  readonly name?: string;
  /** Schedule code, e.g. `RC`, `RI`, `RCRI`. */
  readonly schedule: string;
  /** ISO reporting period end date. */
  readonly periodEnd: string;
  /** Non-empty MDRM items, verbatim from the bulk TSV. */
  readonly values: Readonly<Record<string, string>>;
}

export interface FfiecCallReportOptions extends DataFetchOptions {
  /** Reporting period (see `FfiecBulkDownloadQuery.period`); default latest. */
  readonly period?: string;
  /** Keep only these filers (RSSD IDs). */
  readonly rssdIds?: readonly number[];
  /** Keep only these schedule codes, e.g. `["RC", "RI"]`. */
  readonly schedules?: readonly string[];
  /** Maximum rows returned across all schedules. */
  readonly limit?: number;
}

/**
 * Fetches one quarterly Call Report bulk release as a typed `DataRelease`.
 * Downloads the single-period all-schedules TSV archive (about 6 MB) and
 * flattens it to one row per filer and schedule. `ifNewerThan` skips the
 * download entirely when the latest reporting period is not newer, so
 * watchers poll cheaply. The skip compares reporting periods, not the
 * "Call Updated" stamp: a late refile of an already-fetched quarter is
 * skipped too — compare `fetchFfiecBulkPage().callUpdated` against a prior
 * release's `updatedAt` when revisions matter. Resolves `undefined` when
 * skipped or `limit: 0`.
 */
export async function fetchFfiecCallReport(
  options: FfiecCallReportOptions = {},
): Promise<DataRelease<FfiecCallRow> | undefined> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return undefined;

  const download = await runBulkDownload(
    {
      product: "call-single",
      format: "tsv",
      ...(options.period === undefined ? {} : { period: options.period }),
    },
    options,
    (period) => {
      if (options.ifNewerThan === undefined) return false;
      const asOf = ffiecReportingPeriodDate(period);
      return asOf !== undefined && asOf <= options.ifNewerThan;
    },
  );
  if (download === undefined) return undefined;

  const bundle = await parseFfiecCallBundle(download.bytes);
  const rssdFilter = options.rssdIds === undefined ? undefined : new Set(options.rssdIds);
  const scheduleFilter =
    options.schedules === undefined
      ? undefined
      : new Set(options.schedules.map((code) => code.toUpperCase()));
  const names = new Map(
    bundle.institutions.map((institution) => [institution.rssdId, institution.name]),
  );

  const rows: FfiecCallRow[] = [];
  collecting: for (const schedule of bundle.schedules) {
    if (scheduleFilter !== undefined && !scheduleFilter.has(schedule.code)) continue;
    for (const facts of schedule.facts) {
      if (rssdFilter !== undefined && !rssdFilter.has(facts.rssdId)) continue;
      const name = names.get(facts.rssdId);
      rows.push({
        rssdId: facts.rssdId,
        ...(name === undefined ? {} : { name }),
        schedule: schedule.code,
        periodEnd: bundle.periodEnd,
        values: facts.values,
      });
      if (limit !== undefined && rows.length >= limit) break collecting;
    }
  }

  return {
    provider: "ffiec-cdr",
    dataset: "call-single-period",
    asOf: bundle.periodEnd,
    url: FFIEC_CDR_BULK_DATA_URL,
    ...(download.callUpdated ? { updatedAt: download.callUpdated } : {}),
    rows,
  };
}

/**
 * Binds the quarterly Call Report bulk release (with fixed query options)
 * to the data lane's generic machinery — `fetchDataRelease` and
 * `createDataReleaseWatcher`. Per-call transport options override the
 * bound options.
 */
export function ffiecCallDataSource(
  options: FfiecCallReportOptions = {},
): DataSource<FfiecCallRow> {
  return {
    provider: "ffiec-cdr",
    dataset: "call-single-period",
    requestUrls: () => [FFIEC_CDR_BULK_DATA_URL],
    fetchRelease: (fetchOptions = {}) => fetchFfiecCallReport({ ...options, ...fetchOptions }),
  };
}

/**
 * Renders a Call Report release as one summary news item so scheduled
 * FFIEC drops can ride the news lane (watchers, merging, classification)
 * next to the `ffiec` announcements feed.
 */
export function ffiecReleaseToNewsItems(release: DataRelease<FfiecCallRow>): NewsItem[] {
  if (release.rows.length === 0) return [];
  const filers = new Set(release.rows.map((row) => row.rssdId)).size;
  const schedules = new Set(release.rows.map((row) => row.schedule)).size;
  const title =
    `FFIEC call reports as of ${release.asOf}: ` +
    `${filers} filer${filers === 1 ? "" : "s"} across ${schedules} schedule${schedules === 1 ? "" : "s"}`;
  const publishedText = release.updatedAt ?? release.asOf;
  const published = parsePublishedAt(publishedText);

  return [
    {
      id: stableId(["ffiec-cdr", `${release.dataset}:${release.asOf}`, title]),
      provider: "ffiec-cdr",
      kind: "data",
      title,
      url: release.url,
      source: "FFIEC CDR",
      ...(published ? { publishedAt: published.instant } : {}),
      publishedAtText: publishedText,
      summary:
        `Quarterly bank Call Report bulk data for the ${release.asOf} reporting period` +
        (release.updatedAt ? `, last updated ${release.updatedAt}` : "") +
        ".",
      reportDate: release.asOf,
      eventKind: "regulatory",
      tags: ["ffiec", "call-report", release.dataset],
    },
  ];
}
