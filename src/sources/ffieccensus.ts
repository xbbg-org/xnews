/**
 * FFIEC exposes no documented public geocoding API. The lookup follows the
 * SPA's own published `services.json` binding and token, which can rotate
 * without notice.
 */
import { parseCsvRecords } from "../csv.js";
import { XnewsFetchError } from "../errors.js";
import { BROWSERISH_USER_AGENT, fetchRaw } from "../http.js";
import { isRecord, numberField, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import { readZipEntries } from "../zip.js";
import {
  FFIEC_CENSUS_FLAT_FILES_URL,
  FFIEC_CENSUS_YEARS,
  FFIEC_GEOMAP_SERVICES_URL,
  FFIEC_GEOMAP_URL,
  ffiecCensusArchiveUrl,
  ffiecCensusPeriodEnd,
  ffiecGeocodeCandidateUrl,
  ffiecGeocodeTractUrl,
  isFfiecCensusYear,
} from "./ffieccensus.urls.js";
import type {
  FfiecCensusYear,
  FfiecGeocodePoint,
  FfiecGeocodeServiceBinding,
} from "./ffieccensus.urls.js";

export {
  FFIEC_CENSUS_ARCHIVES,
  FFIEC_CENSUS_DICTIONARIES,
  FFIEC_CENSUS_FLAT_FILES_URL,
  FFIEC_CENSUS_YEARS,
  FFIEC_GEOCODE_OUT_FIELDS,
  FFIEC_GEOMAP_SERVICES_URL,
  FFIEC_GEOMAP_URL,
  ffiecCensusArchiveUrl,
  ffiecCensusDictionaryUrl,
  ffiecCensusPeriodEnd,
  ffiecGeocodeCandidateUrl,
  ffiecGeocodeTractUrl,
  isFfiecCensusYear,
} from "./ffieccensus.urls.js";
export type {
  FfiecCensusYear,
  FfiecGeocodePoint,
  FfiecGeocodeServiceBinding,
} from "./ffieccensus.urls.js";

/** The 2026 archive was 95,033,841 bytes; this leaves room for annual growth. */
export const FFIEC_CENSUS_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
/** Current 2020-census-layout flat files contain exactly 1,212 positional fields. */
export const FFIEC_CENSUS_FIELD_COUNT = 1_212;

export type FfiecTractIncomeLevel = "unknown" | "low" | "moderate" | "middle" | "upper";

export interface FfiecCensusTract {
  readonly censusYear: number;
  readonly msaMdCode: string;
  readonly fipsState: string;
  readonly fipsCounty: string;
  /** Six digits with the decimal point implied, e.g. `020100` means tract 201.00. */
  readonly fipsTract: string;
  readonly tractIncomeLevel?: FfiecTractIncomeLevel;
  readonly msaMdMedianFamilyIncome?: number;
  readonly msaMdMedianHouseholdIncome?: number;
  readonly tractMedianFamilyIncomePercent?: number;
  readonly ffiecEstimatedMsaMdMedianFamilyIncome?: number;
  readonly totalPopulation?: number;
  readonly totalFamilies?: number;
  readonly totalHouseholds?: number;
  readonly totalHousingUnits?: number;
  readonly occupiedHousingUnits?: number;
  readonly vacantHousingUnits?: number;
  readonly ownerOccupiedHousingUnits?: number;
  readonly renterOccupiedHousingUnits?: number;
  readonly distressed?: boolean;
  readonly underserved?: boolean;
  readonly previousYearDistressed?: boolean;
  readonly previousYearUnderserved?: boolean;
  readonly distressedOrUnderserved?: boolean;
  /** The complete original CSV record, excluding its line terminator. */
  readonly raw: string;
  /** Per-field notes for source values that could not be coerced. */
  readonly warnings: readonly string[];
}

export interface FfiecCensusParseOptions {
  readonly expectedYear?: FfiecCensusYear;
  readonly limit?: number;
}

export interface FfiecCensusFetchOptions extends DataFetchOptions {
  /** Maximum tract rows returned after the archive is downloaded. */
  readonly limit?: number;
}

export interface FfiecGeocode {
  readonly censusYear: number;
  readonly msaMdCode: string;
  readonly msaMdName?: string;
  readonly stateCode: string;
  readonly stateName?: string;
  readonly countyCode: string;
  readonly countyName?: string;
  /** Display form returned by FFIEC, e.g. `9800.00`. */
  readonly tract: string;
  readonly fips: string;
  readonly tractIncomeLevel?: FfiecTractIncomeLevel;
  readonly distressed?: boolean;
  readonly matchedAddress?: string;
  readonly score?: number;
  readonly longitude?: number;
  readonly latitude?: number;
  readonly warnings: readonly string[];
}

interface GeomapServices extends FfiecGeocodeServiceBinding {
  readonly censusYear: number;
  readonly matchScore: number;
}

interface GeocodeCandidate {
  readonly matchedAddress?: string;
  readonly score: number;
  readonly point: FfiecGeocodePoint;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function normalizedCensusLimit(limit: number | undefined, url: string): number | undefined {
  try {
    return normalizeLimit(limit);
  } catch {
    throw new XnewsFetchError("config", "FFIEC census limit must be a non-negative integer", {
      url,
    });
  }
}

function censusNumber(
  cells: readonly string[],
  index: number,
  label: string,
  warnings: string[],
): number | undefined {
  const raw = cells[index - 1] ?? "";
  if (raw.trim().length === 0) return undefined;
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  warnings.push(`${label}: invalid numeric value ${JSON.stringify(raw)}`);
  return undefined;
}

function censusFlag(
  cells: readonly string[],
  index: number,
  label: string,
  warnings: string[],
): boolean | undefined {
  const raw = cells[index - 1] ?? "";
  if (raw.trim().length === 0) return false;
  if (raw.trim().toUpperCase() === "X") return true;
  warnings.push(`${label}: invalid flag value ${JSON.stringify(raw)}`);
  return undefined;
}

function censusIncomeLevel(
  cells: readonly string[],
  warnings: string[],
): FfiecTractIncomeLevel | undefined {
  const raw = cells[14] ?? "";
  const levels: Readonly<Record<string, FfiecTractIncomeLevel>> = {
    "0": "unknown",
    "1": "low",
    "2": "moderate",
    "3": "middle",
    "4": "upper",
  };
  const level = levels[raw.trim()];
  if (level !== undefined) return level;
  warnings.push(`tract income level: invalid numeric value ${JSON.stringify(raw)}`);
  return undefined;
}

function parseCensusRecord(
  line: string,
  rowNumber: number,
  expectedYear: number | undefined,
): FfiecCensusTract {
  let records: string[][];
  try {
    records = parseCsvRecords(line);
  } catch {
    throw new XnewsFetchError(
      "network",
      `FFIEC census CSV row ${rowNumber} is truncated or malformed`,
      { url: FFIEC_CENSUS_FLAT_FILES_URL },
    );
  }
  const cells = records[0];
  if (records.length !== 1 || cells === undefined || cells.length !== FFIEC_CENSUS_FIELD_COUNT) {
    throw new XnewsFetchError(
      "network",
      `FFIEC census CSV row ${rowNumber} does not match the 1,212-field positional schema`,
      { url: FFIEC_CENSUS_FLAT_FILES_URL },
    );
  }

  const yearRaw = cells[0] ?? "";
  const msaMdCode = cells[1] ?? "";
  const fipsState = cells[2] ?? "";
  const fipsCounty = cells[3] ?? "";
  const fipsTract = cells[4] ?? "";
  if (
    !/^\d{4}$/.test(yearRaw) ||
    !/^\d{5}$/.test(msaMdCode) ||
    !/^\d{2}$/.test(fipsState) ||
    !/^\d{3}$/.test(fipsCounty) ||
    !/^\d{6}$/.test(fipsTract)
  ) {
    throw new XnewsFetchError(
      "network",
      `FFIEC census CSV row ${rowNumber} has an incompatible key-field schema`,
      { url: FFIEC_CENSUS_FLAT_FILES_URL },
    );
  }
  const censusYear = Number(yearRaw);
  if (expectedYear !== undefined && censusYear !== expectedYear) {
    throw new XnewsFetchError(
      "network",
      `FFIEC census CSV row ${rowNumber} does not belong to the requested census year`,
      { url: FFIEC_CENSUS_FLAT_FILES_URL },
    );
  }

  const warnings: string[] = [];
  const tractIncomeLevel = censusIncomeLevel(cells, warnings);
  const msaMdMedianFamilyIncome = censusNumber(cells, 11, "MSA/MD median family income", warnings);
  const msaMdMedianHouseholdIncome = censusNumber(
    cells,
    12,
    "MSA/MD median household income",
    warnings,
  );
  const tractMedianFamilyIncomePercent = censusNumber(
    cells,
    13,
    "tract median family income percent",
    warnings,
  );
  const ffiecEstimatedMsaMdMedianFamilyIncome = censusNumber(
    cells,
    14,
    "FFIEC estimated MSA/MD median family income",
    warnings,
  );
  const totalPopulation = censusNumber(cells, 23, "total population", warnings);
  const totalFamilies = censusNumber(cells, 24, "total families", warnings);
  const totalHouseholds = censusNumber(cells, 25, "total households", warnings);
  const totalHousingUnits = censusNumber(cells, 873, "total housing units", warnings);
  const occupiedHousingUnits = censusNumber(cells, 877, "occupied housing units", warnings);
  const vacantHousingUnits = censusNumber(cells, 878, "vacant housing units", warnings);
  const ownerOccupiedHousingUnits = censusNumber(
    cells,
    880,
    "owner occupied housing units",
    warnings,
  );
  const renterOccupiedHousingUnits = censusNumber(
    cells,
    881,
    "renter occupied housing units",
    warnings,
  );
  const distressed = censusFlag(cells, 18, "CRA distressed criteria", warnings);
  const underserved = censusFlag(cells, 19, "CRA underserved criteria", warnings);
  const previousYearDistressed = censusFlag(
    cells,
    20,
    "previous-year CRA distressed criteria",
    warnings,
  );
  const previousYearUnderserved = censusFlag(
    cells,
    21,
    "previous-year CRA underserved criteria",
    warnings,
  );
  const distressedOrUnderserved = censusFlag(
    cells,
    22,
    "current-or-previous CRA distressed/underserved criteria",
    warnings,
  );

  return {
    censusYear,
    msaMdCode,
    fipsState,
    fipsCounty,
    fipsTract,
    ...(tractIncomeLevel === undefined ? {} : { tractIncomeLevel }),
    ...(msaMdMedianFamilyIncome === undefined ? {} : { msaMdMedianFamilyIncome }),
    ...(msaMdMedianHouseholdIncome === undefined ? {} : { msaMdMedianHouseholdIncome }),
    ...(tractMedianFamilyIncomePercent === undefined ? {} : { tractMedianFamilyIncomePercent }),
    ...(ffiecEstimatedMsaMdMedianFamilyIncome === undefined
      ? {}
      : { ffiecEstimatedMsaMdMedianFamilyIncome }),
    ...(totalPopulation === undefined ? {} : { totalPopulation }),
    ...(totalFamilies === undefined ? {} : { totalFamilies }),
    ...(totalHouseholds === undefined ? {} : { totalHouseholds }),
    ...(totalHousingUnits === undefined ? {} : { totalHousingUnits }),
    ...(occupiedHousingUnits === undefined ? {} : { occupiedHousingUnits }),
    ...(vacantHousingUnits === undefined ? {} : { vacantHousingUnits }),
    ...(ownerOccupiedHousingUnits === undefined ? {} : { ownerOccupiedHousingUnits }),
    ...(renterOccupiedHousingUnits === undefined ? {} : { renterOccupiedHousingUnits }),
    ...(distressed === undefined ? {} : { distressed }),
    ...(underserved === undefined ? {} : { underserved }),
    ...(previousYearDistressed === undefined ? {} : { previousYearDistressed }),
    ...(previousYearUnderserved === undefined ? {} : { previousYearUnderserved }),
    ...(distressedOrUnderserved === undefined ? {} : { distressedOrUnderserved }),
    raw: line,
    warnings,
  };
}

/** Parses the headerless, positional FFIEC census CSV. */
export function parseFfiecCensusCsv(
  body: string,
  options: FfiecCensusParseOptions = {},
): readonly FfiecCensusTract[] {
  const limit = normalizedCensusLimit(options.limit, FFIEC_CENSUS_FLAT_FILES_URL);
  if (limit === 0) return [];

  // All 1,212 documented fields are codes or numbers, so a physical line is
  // one record. Parsing one line at a time avoids retaining 100M cell strings.
  const rows: FfiecCensusTract[] = [];
  let start = 0;
  let rowNumber = 0;
  for (let cursor = 0; cursor <= body.length; cursor += 1) {
    if (cursor < body.length && body.charCodeAt(cursor) !== 10) continue;
    let end = cursor;
    if (end > start && body.charCodeAt(end - 1) === 13) end -= 1;
    const line = body.slice(start, end);
    start = cursor + 1;
    if (line.trim().length === 0) continue;
    rowNumber += 1;
    rows.push(parseCensusRecord(line, rowNumber, options.expectedYear));
    if (limit !== undefined && rows.length >= limit) return rows;
  }
  if (rows.length === 0) {
    throw new XnewsFetchError("network", "FFIEC census CSV contained no tract records", {
      url: FFIEC_CENSUS_FLAT_FILES_URL,
    });
  }
  return rows;
}

/** Unzips and parses a current-layout annual FFIEC census archive. */
export async function parseFfiecCensusArchive(
  archive: Uint8Array,
  options: FfiecCensusParseOptions = {},
): Promise<readonly FfiecCensusTract[]> {
  const limit = normalizedCensusLimit(options.limit, FFIEC_CENSUS_FLAT_FILES_URL);
  if (limit === 0) return [];

  let entries;
  try {
    entries = await readZipEntries(archive, "FFIEC census archive");
  } catch {
    throw new XnewsFetchError("network", "FFIEC census archive is truncated or malformed", {
      url: FFIEC_CENSUS_FLAT_FILES_URL,
    });
  }
  const csvEntries = entries.filter((entry) =>
    /(?:^|\/)CensusFlatFile\d{4}[^/]*\.csv$/i.test(entry.name),
  );
  const entry = csvEntries[0];
  if (entry === undefined || csvEntries.length !== 1) {
    throw new XnewsFetchError(
      "network",
      "FFIEC census archive did not contain exactly one census flat-file CSV",
      { url: FFIEC_CENSUS_FLAT_FILES_URL },
    );
  }

  const rows: FfiecCensusTract[] = [];
  let start = 0;
  let rowNumber = 0;
  for (let cursor = 0; cursor <= entry.bytes.length; cursor += 1) {
    if (cursor < entry.bytes.length && entry.bytes[cursor] !== 10) continue;
    let end = cursor;
    if (end > start && entry.bytes[end - 1] === 13) end -= 1;
    if (end === start) {
      start = cursor + 1;
      continue;
    }
    let line: string;
    try {
      line = utf8Decoder.decode(entry.bytes.subarray(start, end));
    } catch {
      throw new XnewsFetchError("network", "FFIEC census CSV is not valid UTF-8", {
        url: FFIEC_CENSUS_FLAT_FILES_URL,
      });
    }
    start = cursor + 1;
    if (line.trim().length === 0) continue;
    rowNumber += 1;
    rows.push(parseCensusRecord(line, rowNumber, options.expectedYear));
    if (limit !== undefined && rows.length >= limit) return rows;
  }
  if (rows.length === 0) {
    throw new XnewsFetchError("network", "FFIEC census archive contained no tract records", {
      url: FFIEC_CENSUS_FLAT_FILES_URL,
    });
  }
  return rows;
}

/** Downloads and parses one annual census flat-file release. */
export async function fetchFfiecCensus(
  year: number,
  options: FfiecCensusFetchOptions = {},
): Promise<DataRelease<FfiecCensusTract> | undefined> {
  if (!isFfiecCensusYear(year)) {
    throw new XnewsFetchError(
      "config",
      `FFIEC census year must be one of ${FFIEC_CENSUS_YEARS.join(", ")}`,
      { url: FFIEC_CENSUS_FLAT_FILES_URL },
    );
  }
  const archiveUrl = ffiecCensusArchiveUrl(year);
  const asOf = ffiecCensusPeriodEnd(year);
  const limit = normalizedCensusLimit(options.limit, archiveUrl);
  if (limit === 0) return undefined;
  if (options.ifNewerThan !== undefined && options.ifNewerThan >= asOf) return undefined;

  const response = await fetchRaw(
    archiveUrl,
    {
      ...options,
      maxResponseBytes: options.maxResponseBytes ?? FFIEC_CENSUS_ARCHIVE_MAX_BYTES,
    },
    { userAgent: options.userAgent ?? BROWSERISH_USER_AGENT },
  );
  const rows = await parseFfiecCensusArchive(response.bytes, {
    expectedYear: year,
    ...(limit === undefined ? {} : { limit }),
  });
  return {
    provider: "ffiec-census",
    dataset: `census-flat-file-${year}`,
    asOf,
    url: archiveUrl,
    rows,
  };
}

/** Binds one annual FFIEC census flat file to the structured data lane. */
export function ffiecCensusDataSource(
  year: number,
  options: FfiecCensusFetchOptions = {},
): DataSource<FfiecCensusTract> {
  const archiveUrl = ffiecCensusArchiveUrl(year);
  const asOf = ffiecCensusPeriodEnd(year);
  return {
    provider: "ffiec-census",
    dataset: `census-flat-file-${year}`,
    requestUrls: (fetchOptions = {}) => {
      if (options.limit === 0) return [];
      const ifNewerThan = fetchOptions.ifNewerThan ?? options.ifNewerThan;
      return ifNewerThan !== undefined && ifNewerThan >= asOf ? [] : [archiveUrl];
    },
    fetchRelease: (fetchOptions = {}) => fetchFfiecCensus(year, { ...options, ...fetchOptions }),
  };
}

function parseGeomapServices(body: string): GeomapServices {
  let payload: Record<string, unknown>;
  try {
    payload = parseJsonRecord(body, "FFIEC geomap service manifest");
  } catch {
    throw new XnewsFetchError("network", "FFIEC geomap service manifest was not valid JSON", {
      url: FFIEC_GEOMAP_SERVICES_URL,
    });
  }
  const censusYear = numberField(payload, "maxCensusYear");
  const serviceAuth = payload["serviceAuth"];
  const featureUrls = payload["arcgisFeatureUrls"];
  const geocodeServiceUrl = stringField(payload, "geocodeServiceUrl")?.trim();
  const matchScore = numberField(payload, "matchScore");
  if (
    censusYear === undefined ||
    !Number.isInteger(censusYear) ||
    censusYear < 2000 ||
    censusYear > 9999 ||
    !isRecord(serviceAuth) ||
    !isRecord(featureUrls) ||
    geocodeServiceUrl === undefined ||
    matchScore === undefined ||
    matchScore < 0 ||
    matchScore > 100
  ) {
    throw new XnewsFetchError(
      "network",
      "FFIEC geomap service manifest had an incompatible schema",
      {
        url: FFIEC_GEOMAP_SERVICES_URL,
      },
    );
  }
  const clientPrefix = stringField(serviceAuth, "clientPrefix");
  const sessionHash = stringField(serviceAuth, "sessionHash");
  const tokenSuffix = stringField(serviceAuth, "tokenSuffix");
  const featureUrl = stringField(featureUrls, "url0")?.trim();
  if (
    clientPrefix === undefined ||
    sessionHash === undefined ||
    tokenSuffix === undefined ||
    featureUrl === undefined ||
    clientPrefix.length === 0 ||
    sessionHash.length === 0 ||
    tokenSuffix.length === 0
  ) {
    throw new XnewsFetchError(
      "network",
      "FFIEC geomap service manifest omitted its public binding",
      {
        url: FFIEC_GEOMAP_SERVICES_URL,
      },
    );
  }

  let geocodeUrl: URL;
  let featureServiceUrl: URL;
  try {
    geocodeUrl = new URL(geocodeServiceUrl);
    featureServiceUrl = new URL(featureUrl);
  } catch {
    throw new XnewsFetchError("network", "FFIEC geomap service manifest contained invalid URLs", {
      url: FFIEC_GEOMAP_SERVICES_URL,
    });
  }
  const serviceYear = /census_tract_(\d{4})_geodemo/i.exec(featureServiceUrl.pathname)?.[1];
  if (
    geocodeUrl.protocol !== "https:" ||
    geocodeUrl.hostname !== "geocode-api.arcgis.com" ||
    featureServiceUrl.protocol !== "https:" ||
    featureServiceUrl.hostname !== "utility.arcgis.com" ||
    serviceYear !== String(censusYear)
  ) {
    throw new XnewsFetchError(
      "network",
      "FFIEC geomap service manifest pointed outside its expected ArcGIS services",
      { url: FFIEC_GEOMAP_SERVICES_URL },
    );
  }

  return {
    censusYear,
    matchScore,
    geocodeServiceUrl: geocodeUrl.toString(),
    featureUrl: featureServiceUrl.toString(),
    token: clientPrefix + sessionHash + tokenSuffix,
  };
}

function parseGeocodeCandidate(body: string, matchScore: number): GeocodeCandidate | undefined {
  let payload: Record<string, unknown>;
  try {
    payload = parseJsonRecord(body, "FFIEC geomap address match");
  } catch {
    throw new XnewsFetchError("network", "FFIEC geomap address response was not valid JSON", {
      url: FFIEC_GEOMAP_URL,
    });
  }
  const rawCandidates = payload["candidates"];
  if (!Array.isArray(rawCandidates)) {
    throw new XnewsFetchError(
      "network",
      "FFIEC geomap address response had an incompatible schema",
      {
        url: FFIEC_GEOMAP_URL,
      },
    );
  }
  if (rawCandidates.length === 0) return undefined;
  const candidates = recordArray(rawCandidates);
  const candidate = candidates[0];
  if (
    candidates.length !== rawCandidates.length ||
    candidate === undefined ||
    !isRecord(candidate["attributes"]) ||
    !isRecord(candidate["location"])
  ) {
    throw new XnewsFetchError(
      "network",
      "FFIEC geomap address response had a malformed candidate",
      {
        url: FFIEC_GEOMAP_URL,
      },
    );
  }
  const addressType = stringField(candidate["attributes"], "Addr_type")?.toUpperCase();
  const status = stringField(candidate["attributes"], "Status")?.toUpperCase();
  const score = numberField(candidate, "score");
  const longitude = numberField(candidate["location"], "x");
  const latitude = numberField(candidate["location"], "y");
  if (
    addressType === undefined ||
    status === undefined ||
    score === undefined ||
    score < 0 ||
    score > 100 ||
    longitude === undefined ||
    longitude < -180 ||
    longitude > 180 ||
    latitude === undefined ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new XnewsFetchError("network", "FFIEC geomap address response omitted match fields", {
      url: FFIEC_GEOMAP_URL,
    });
  }
  if (
    !["POINTADDRESS", "SUBADDRESS", "STREETADDRESS"].includes(addressType) ||
    !["M", "T"].includes(status) ||
    score < matchScore
  ) {
    return undefined;
  }
  const matchedAddress = stringField(candidate, "address")?.trim();
  return {
    ...(matchedAddress === undefined || matchedAddress.length === 0 ? {} : { matchedAddress }),
    score,
    point: { longitude, latitude },
  };
}

/** Parses one FFIEC census-tract FeatureServer query response. */
export function parseFfiecGeocode(body: string, censusYear: number): FfiecGeocode | undefined {
  if (!Number.isInteger(censusYear) || censusYear < 2000 || censusYear > 9999) {
    throw new XnewsFetchError("config", "FFIEC geocode census year must be a four-digit year", {
      url: FFIEC_GEOMAP_URL,
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseJsonRecord(body, "FFIEC geomap tract query");
  } catch {
    throw new XnewsFetchError("network", "FFIEC geomap tract response was not valid JSON", {
      url: FFIEC_GEOMAP_URL,
    });
  }
  const rawFeatures = payload["features"];
  if (!Array.isArray(rawFeatures)) {
    throw new XnewsFetchError("network", "FFIEC geomap tract response had an incompatible schema", {
      url: FFIEC_GEOMAP_URL,
    });
  }
  if (rawFeatures.length === 0) return undefined;
  const features = recordArray(rawFeatures);
  const feature = features[0];
  const attributes = feature?.["attributes"];
  if (features.length !== rawFeatures.length || feature === undefined || !isRecord(attributes)) {
    throw new XnewsFetchError("network", "FFIEC geomap tract response had a malformed feature", {
      url: FFIEC_GEOMAP_URL,
    });
  }

  const msaMdCode = stringField(attributes, "MSA_Code")?.trim();
  const stateCode = stringField(attributes, "State_Code")?.trim();
  const countyCode = stringField(attributes, "County_Code")?.trim();
  const tract = stringField(attributes, "Tract_Code")?.trim();
  const fips = stringField(attributes, "FIPS")?.trim();
  const tractDigits = tract?.replace(".", "");
  if (
    msaMdCode === undefined ||
    stateCode === undefined ||
    countyCode === undefined ||
    tract === undefined ||
    fips === undefined ||
    !/^\d{5}$/.test(msaMdCode) ||
    !/^\d{2}$/.test(stateCode) ||
    !/^\d{3}$/.test(countyCode) ||
    !/^\d{4}\.\d{2}$/.test(tract) ||
    !/^\d{11}$/.test(fips) ||
    fips !== `${stateCode}${countyCode}${tractDigits}`
  ) {
    throw new XnewsFetchError("network", "FFIEC geomap tract response had invalid geography keys", {
      url: FFIEC_GEOMAP_URL,
    });
  }

  const warnings: string[] = [];
  const rawIncomeLevel = stringField(attributes, "Income_Indicator")?.trim() ?? "";
  const incomeLevels: Readonly<Record<string, FfiecTractIncomeLevel>> = {
    Unknown: "unknown",
    Low: "low",
    Moderate: "moderate",
    Middle: "middle",
    Upper: "upper",
  };
  const tractIncomeLevel = incomeLevels[rawIncomeLevel];
  if (tractIncomeLevel === undefined) {
    warnings.push(`tract income level: invalid value ${JSON.stringify(rawIncomeLevel)}`);
  }
  const rawDistressed = stringField(attributes, "DistressedTractInd") ?? "";
  let distressed: boolean | undefined;
  if (rawDistressed.trim().length === 0) distressed = false;
  else if (rawDistressed.trim().toUpperCase() === "X") distressed = true;
  else warnings.push(`distressed tract indicator: invalid value ${JSON.stringify(rawDistressed)}`);

  const msaMdName = stringField(attributes, "MSA_Name")?.trim();
  const stateName = stringField(attributes, "State_Name")?.trim();
  const countyName = stringField(attributes, "County_Name")?.trim();
  return {
    censusYear,
    msaMdCode,
    ...(msaMdName === undefined || msaMdName.length === 0 ? {} : { msaMdName }),
    stateCode,
    ...(stateName === undefined || stateName.length === 0 ? {} : { stateName }),
    countyCode,
    ...(countyName === undefined || countyName.length === 0 ? {} : { countyName }),
    tract,
    fips,
    ...(tractIncomeLevel === undefined ? {} : { tractIncomeLevel }),
    ...(distressed === undefined ? {} : { distressed }),
    warnings,
  };
}

async function fetchGeomapJson(url: string, options: SourceFetchOptions): Promise<string> {
  const response = await fetchRaw(url, options, {
    userAgent: options.userAgent ?? BROWSERISH_USER_AGENT,
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: FFIEC_GEOMAP_URL,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  try {
    return utf8Decoder.decode(response.bytes);
  } catch {
    throw new XnewsFetchError("network", "FFIEC geomap returned invalid UTF-8", { url });
  }
}

/** Resolves an address through the FFIEC geomap's current ArcGIS bindings. */
export async function fetchFfiecGeocode(
  address: string,
  options: SourceFetchOptions = {},
): Promise<FfiecGeocode | undefined> {
  if (address.trim().length === 0) {
    throw new XnewsFetchError("config", "FFIEC geocoding requires a non-empty address", {
      url: FFIEC_GEOMAP_URL,
    });
  }

  const services = parseGeomapServices(await fetchGeomapJson(FFIEC_GEOMAP_SERVICES_URL, options));
  const candidateUrl = ffiecGeocodeCandidateUrl(address, services);
  const candidate = parseGeocodeCandidate(
    await fetchGeomapJson(candidateUrl, options),
    services.matchScore,
  );
  if (candidate === undefined) return undefined;

  const tractUrl = ffiecGeocodeTractUrl(candidate.point, services);
  const tract = parseFfiecGeocode(await fetchGeomapJson(tractUrl, options), services.censusYear);
  if (tract === undefined) return undefined;
  return {
    ...tract,
    ...(candidate.matchedAddress === undefined ? {} : { matchedAddress: candidate.matchedAddress }),
    score: candidate.score,
    longitude: candidate.point.longitude,
    latitude: candidate.point.latitude,
  };
}
