import { parsePublishedAt } from "../dates.js";
import { filterEvents } from "../events.js";
import { fetchRaw, fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import { cleanText, safeHttpUrl } from "../text.js";
import { readZipEntries } from "../zip.js";
import {
  GDELT_EVENT_COLUMNS,
  GDELT_EVENTS_DATASET,
  GDELT_EVENTS_LAST_UPDATE_URL,
} from "./gdeltevents.urls.js";
import type { EventFetchOptions, EventRecord, EventSeverity, EventSource } from "../types.js";

export {
  GDELT_EVENT_COLUMNS,
  GDELT_EVENTS_BASE_URL,
  GDELT_EVENTS_DATASET,
  GDELT_EVENTS_LAST_UPDATE_URL,
} from "./gdeltevents.urls.js";

export interface GdeltExportSlice {
  readonly exportUrl: string;
  /** Fourteen-digit UTC timestamp carried by the export filename. */
  readonly sliceTimestamp: string;
}

interface FetchedGdeltSlice extends GdeltExportSlice {
  readonly events: readonly EventRecord[];
}

const GDELT_EXPORT_SHAPE_ERROR = "unexpected GDELT v2 event export TSV shape";
const GDELT_DISTRIBUTION_HOST = "data.gdeltproject.org";
const GDELT_EXPORT_FILE_PATTERN = /\/(\d{14})\.export\.CSV\.zip$/i;
const GDELT_TSV_ENTRY_PATTERN = /\.export\.CSV$/i;

const CAMEO_ROOT_LABELS: Readonly<Record<string, string>> = {
  "01": "Make Public Statement",
  "02": "Appeal",
  "03": "Express Intent to Cooperate",
  "04": "Consult",
  "05": "Engage in Diplomatic Cooperation",
  "06": "Engage in Material Cooperation",
  "07": "Provide Aid",
  "08": "Yield",
  "09": "Investigate",
  "10": "Demand",
  "11": "Disapprove",
  "12": "Reject",
  "13": "Threaten",
  "14": "Protest",
  "15": "Exhibit Force Posture",
  "16": "Reduce Relations",
  "17": "Coerce",
  "18": "Assault",
  "19": "Fight",
  "20": "Use Unconventional Mass Violence",
};

/**
 * FIPS 10-4 is not ISO 3166-1: many identical-looking codes identify different
 * countries. This explicit conversion includes both differing and identical
 * assignments, so an unknown FIPS value is never passed through as though it
 * were ISO. Withdrawn ISO code AN and entities without an official ISO-2 code
 * are deliberately absent.
 */
const FIPS_TO_ISO2: Readonly<Record<string, string>> = {
  AA: "AW",
  AC: "AG",
  AE: "AE",
  AF: "AF",
  AG: "DZ",
  AJ: "AZ",
  AL: "AL",
  AM: "AM",
  AN: "AD",
  AO: "AO",
  AQ: "AS",
  AR: "AR",
  AS: "AU",
  AU: "AT",
  AV: "AI",
  AY: "AQ",
  BA: "BH",
  BB: "BB",
  BC: "BW",
  BD: "BM",
  BE: "BE",
  BF: "BS",
  BG: "BD",
  BH: "BZ",
  BK: "BA",
  BL: "BO",
  BM: "MM",
  BN: "BJ",
  BO: "BY",
  BP: "SB",
  BR: "BR",
  BT: "BT",
  BU: "BG",
  BX: "BN",
  BY: "BI",
  CA: "CA",
  CB: "KH",
  CD: "TD",
  CE: "LK",
  CF: "CG",
  CG: "CD",
  CH: "CN",
  CI: "CL",
  CJ: "KY",
  CK: "CC",
  CM: "CM",
  CN: "KM",
  CO: "CO",
  CQ: "MP",
  CS: "CR",
  CT: "CF",
  CU: "CU",
  CV: "CV",
  CW: "CK",
  CY: "CY",
  DA: "DK",
  DJ: "DJ",
  DO: "DM",
  DR: "DO",
  EC: "EC",
  EG: "EG",
  EI: "IE",
  EK: "GQ",
  EN: "EE",
  ER: "ER",
  ES: "SV",
  ET: "ET",
  EZ: "CZ",
  FG: "GF",
  FI: "FI",
  FJ: "FJ",
  FK: "FK",
  FM: "FM",
  FO: "FO",
  FP: "PF",
  FR: "FR",
  FS: "TF",
  GA: "GM",
  GB: "GA",
  GG: "GE",
  GH: "GH",
  GI: "GI",
  GJ: "GD",
  GL: "GL",
  GM: "DE",
  GP: "GP",
  GQ: "GU",
  GR: "GR",
  GT: "GT",
  GV: "GN",
  GY: "GY",
  GZ: "PS",
  HA: "HT",
  HK: "HK",
  HO: "HN",
  HR: "HR",
  HU: "HU",
  IC: "IS",
  ID: "ID",
  IN: "IN",
  IR: "IR",
  IS: "IL",
  IT: "IT",
  IV: "CI",
  IZ: "IQ",
  JA: "JP",
  JM: "JM",
  JO: "JO",
  KE: "KE",
  KG: "KG",
  KN: "KP",
  KR: "KI",
  KS: "KR",
  KT: "CX",
  KU: "KW",
  KZ: "KZ",
  LA: "LA",
  LE: "LB",
  LG: "LV",
  LH: "LT",
  LI: "LR",
  LO: "SK",
  LS: "LI",
  LT: "LS",
  LU: "LU",
  LY: "LY",
  MA: "MG",
  MB: "MQ",
  MC: "MO",
  MD: "MD",
  MF: "YT",
  MG: "MN",
  MI: "MW",
  MJ: "MS",
  MK: "MK",
  ML: "ML",
  MN: "MC",
  MO: "MA",
  MP: "MU",
  MR: "MR",
  MT: "MT",
  MV: "MV",
  MW: "ME",
  MX: "MX",
  MY: "MY",
  MZ: "MZ",
  NC: "NC",
  NE: "NU",
  NF: "NF",
  NG: "NE",
  NH: "VU",
  NI: "NG",
  NL: "NL",
  NO: "NO",
  NP: "NP",
  NR: "NR",
  NS: "SR",
  NU: "NI",
  NZ: "NZ",
  OD: "SS",
  PA: "PY",
  PC: "PN",
  PE: "PE",
  PK: "PK",
  PL: "PL",
  PM: "PA",
  PO: "PT",
  PP: "PG",
  PS: "PW",
  PU: "GW",
  RE: "RE",
  RI: "RS",
  RM: "MH",
  RO: "RO",
  RP: "PH",
  RQ: "PR",
  RS: "RU",
  RW: "RW",
  SA: "SA",
  SB: "PM",
  SC: "KN",
  SE: "SC",
  SF: "ZA",
  SG: "SN",
  SH: "SH",
  SI: "SI",
  SL: "SL",
  SM: "SM",
  SN: "SG",
  SO: "SO",
  SP: "ES",
  ST: "LC",
  SU: "SD",
  SV: "SJ",
  SW: "SE",
  SX: "GS",
  SY: "SY",
  SZ: "CH",
  TD: "TT",
  TH: "TH",
  TI: "TJ",
  TK: "TC",
  TL: "TK",
  TN: "TO",
  TO: "TG",
  TP: "ST",
  TS: "TN",
  TT: "TL",
  TU: "TR",
  TV: "TV",
  TW: "TW",
  TX: "TM",
  TZ: "TZ",
  UG: "UG",
  UK: "GB",
  UP: "UA",
  US: "US",
  UV: "BF",
  UY: "UY",
  UZ: "UZ",
  VC: "VC",
  VE: "VE",
  VG: "VI",
  VI: "VG",
  VM: "VN",
  VQ: "VI",
  VT: "VA",
  WA: "NA",
  WE: "PS",
  WF: "WF",
  WI: "EH",
  WS: "WS",
  WZ: "SZ",
  YM: "YE",
  ZA: "ZM",
  ZI: "ZW",
};

/** Finds the newest event export and upgrades GDELT's legacy HTTP URL to HTTPS. */
export function parseGdeltLastUpdate(text: string): GdeltExportSlice | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\d+\s+[0-9a-f]{32}\s+(https?:\/\/\S+)\s*$/i.exec(line);
    if (match?.[1] === undefined) continue;

    const safeUrl = safeHttpUrl(match[1]);
    if (safeUrl === undefined) continue;
    const url = new URL(safeUrl);
    const fileMatch = GDELT_EXPORT_FILE_PATTERN.exec(url.pathname);
    if (
      fileMatch?.[1] === undefined ||
      url.hostname.toLowerCase() !== GDELT_DISTRIBUTION_HOST ||
      (url.protocol !== "http:" && url.protocol !== "https:")
    ) {
      continue;
    }

    const sliceTimestamp = fileMatch[1];
    sliceTimestampToInstant(sliceTimestamp);
    url.protocol = "https:";
    return { exportUrl: url.toString(), sliceTimestamp };
  }
  return undefined;
}

/**
 * Parses one headerless GDELT 2.0 event export. Rows shorter than the published
 * 61-column schema are ignored unless every non-empty row has the wrong shape.
 */
export function parseGdeltExportTsv(tsv: string, sliceTimestamp: string): EventRecord[] {
  const observedAt = sliceTimestampToInstant(sliceTimestamp);
  const events: EventRecord[] = [];
  const seenIds = new Set<string>();
  let nonEmptyRows = 0;
  let shapedRows = 0;

  for (const rawLine of tsv.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") continue;
    nonEmptyRows += 1;

    const fields = line.split("\t");
    if (fields.length <= GDELT_EVENT_COLUMNS.sourceUrl) continue;
    shapedRows += 1;

    const globalEventId = fields[GDELT_EVENT_COLUMNS.globalEventId]?.trim();
    if (!globalEventId) continue;
    const id = `gdelt-${globalEventId}`;
    if (seenIds.has(id)) continue;

    const coordinates = gdeltCoordinates(fields);
    if (coordinates === null) continue;

    const goldstein = finiteNumber(fields[GDELT_EVENT_COLUMNS.goldsteinScale]);
    const quadClass = finiteNumber(fields[GDELT_EVENT_COLUMNS.quadClass]);
    const rootCode = fields[GDELT_EVENT_COLUMNS.eventRootCode]?.trim().padStart(2, "0") ?? "";
    const rootLabel = CAMEO_ROOT_LABELS[rootCode] ?? "GDELT Event";
    const areaName = cleanText(fields[GDELT_EVENT_COLUMNS.actionGeoFullName] ?? "");
    const countryCode = fipsCountryToIso2(fields[GDELT_EVENT_COLUMNS.actionGeoCountryCode]);
    const sourceUrl = safeHttpUrl(fields[GDELT_EVENT_COLUMNS.sourceUrl]?.trim() ?? "");
    const eventType = fields[GDELT_EVENT_COLUMNS.eventCode]?.trim();

    events.push({
      id,
      provider: "gdelt-events",
      category: "conflict",
      title: areaName ? `${rootLabel} — ${areaName}` : rootLabel,
      severity: gdeltSeverity(quadClass, goldstein),
      observedAt,
      ...(goldstein !== undefined ? { magnitude: goldstein, magnitudeUnit: "goldstein" } : {}),
      ...(countryCode !== undefined ? { countryCode } : {}),
      ...(areaName ? { areaName } : {}),
      ...(eventType ? { eventType } : {}),
      ...(sourceUrl !== undefined ? { url: sourceUrl } : {}),
      ...coordinates,
    });
    seenIds.add(id);
  }

  if (nonEmptyRows > 0 && shapedRows === 0) throw new Error(GDELT_EXPORT_SHAPE_ERROR);
  return events;
}

/** Fetches the newest 15-minute GDELT event slice. */
export async function fetchGdeltEvents(options: EventFetchOptions = {}): Promise<EventRecord[]> {
  if (normalizeLimit(options.limit) === 0) return [];
  const slice = await fetchGdeltSlice(options);
  if (slice === undefined) return [];
  return selectGdeltEvents(slice.events, options);
}

/** Binds the newest-slice discovery chain to the events lane. */
export function gdeltEventsSource(options: EventFetchOptions = {}): EventSource {
  const merged = (fetchOptions: EventFetchOptions): EventFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: "gdelt-events",
    dataset: GDELT_EVENTS_DATASET,
    requestUrls() {
      return [GDELT_EVENTS_LAST_UPDATE_URL];
    },
    async fetchSnapshot(fetchOptions = {}) {
      const combined = merged(fetchOptions);
      if (normalizeLimit(combined.limit) === 0) return undefined;
      const slice = await fetchGdeltSlice(combined);
      if (slice === undefined) return undefined;
      const events = selectGdeltEvents(slice.events, combined);
      if (events.length === 0) return undefined;
      return {
        provider: "gdelt-events",
        dataset: GDELT_EVENTS_DATASET,
        observedAt: sliceTimestampToInstant(slice.sliceTimestamp),
        events,
        warnings: [],
        requestUrls: [GDELT_EVENTS_LAST_UPDATE_URL, slice.exportUrl],
      };
    },
  };
}

async function fetchGdeltSlice(options: EventFetchOptions): Promise<FetchedGdeltSlice | undefined> {
  const discovery = parseGdeltLastUpdate(await fetchText(GDELT_EVENTS_LAST_UPDATE_URL, options));
  if (discovery === undefined) return undefined;

  const archive = await fetchRaw(discovery.exportUrl, options);
  const entries = await readZipEntries(archive.bytes, discovery.exportUrl);
  if (entries.length === 0) return { ...discovery, events: [] };
  const tsvEntry = entries.find((entry) => GDELT_TSV_ENTRY_PATTERN.test(entry.name));
  if (tsvEntry === undefined) throw new Error(GDELT_EXPORT_SHAPE_ERROR);

  const tsv = new TextDecoder().decode(tsvEntry.bytes);
  return { ...discovery, events: parseGdeltExportTsv(tsv, discovery.sliceTimestamp) };
}

function selectGdeltEvents(
  events: readonly EventRecord[],
  options: EventFetchOptions,
): EventRecord[] {
  const filtered = filterEvents(events, options);
  const limit = normalizeLimit(options.limit);
  return limit === undefined ? [...filtered] : filtered.slice(0, limit);
}

/**
 * QuadClass identifies cooperation versus conflict; Goldstein distinguishes
 * the most destabilizing material-conflict acts. The -7 threshold reserves
 * `extreme` for the violent end of GDELT's -10..+10 scale.
 */
function gdeltSeverity(
  quadClass: number | undefined,
  goldstein: number | undefined,
): EventSeverity {
  if (quadClass === 4 && goldstein !== undefined && goldstein <= -7) return "extreme";
  if (quadClass === 4) return "severe";
  if (quadClass === 3) return "moderate";
  return "minor";
}

function gdeltCoordinates(
  fields: readonly string[],
): { readonly latitude?: number; readonly longitude?: number } | null {
  const latitude = finiteNumber(fields[GDELT_EVENT_COLUMNS.actionGeoLatitude]);
  const longitude = finiteNumber(fields[GDELT_EVENT_COLUMNS.actionGeoLongitude]);
  if (latitude === 0 && longitude === 0) return null;
  if (
    latitude === undefined ||
    longitude === undefined ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return {};
  }
  return { latitude, longitude };
}

function fipsCountryToIso2(value: string | undefined): string | undefined {
  const fips = value?.trim().toUpperCase();
  return fips ? FIPS_TO_ISO2[fips] : undefined;
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sliceTimestampToInstant(sliceTimestamp: string): string {
  if (!/^\d{14}$/.test(sliceTimestamp)) {
    throw new Error(`invalid GDELT slice timestamp ${JSON.stringify(sliceTimestamp)}`);
  }
  const gdeltTimestamp = `${sliceTimestamp.slice(0, 8)}T${sliceTimestamp.slice(8)}Z`;
  const parsed = parsePublishedAt(gdeltTimestamp);
  if (parsed === null) {
    throw new Error(`invalid GDELT slice timestamp ${JSON.stringify(sliceTimestamp)}`);
  }
  return parsed.instant;
}
