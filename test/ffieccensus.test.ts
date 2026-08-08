import { expect, test } from "bun:test";
import { fetchDataRelease } from "../src/data.js";
import { BROWSERISH_USER_AGENT, XnewsFetchError } from "../src/http.js";
import {
  FFIEC_CENSUS_ARCHIVE_MAX_BYTES,
  FFIEC_CENSUS_FIELD_COUNT,
  fetchFfiecCensus,
  fetchFfiecGeocode,
  ffiecCensusArchiveUrl,
  ffiecCensusDataSource,
  ffiecCensusDictionaryUrl,
  ffiecCensusPeriodEnd,
  ffiecGeocodeCandidateUrl,
  ffiecGeocodeTractUrl,
  parseFfiecCensusArchive,
  parseFfiecCensusCsv,
  parseFfiecGeocode,
} from "../src/sources/ffieccensus.js";

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
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

function censusFixture(overrides: Readonly<Record<number, string>> = {}): string {
  const cells = Array<string>(FFIEC_CENSUS_FIELD_COUNT).fill("");
  const observed: Readonly<Record<number, string>> = {
    1: "2026",
    2: "33860",
    3: "01",
    4: "001",
    5: "020100",
    6: "0",
    7: "T",
    8: "N",
    9: "D",
    10: "M",
    11: "68115",
    12: "54250",
    13: "103.79",
    14: "88800",
    15: "3",
    23: "1775",
    24: "555",
    25: "693",
    26: "963",
    27: "978",
    28: "399",
    29: "22.48",
    873: "710",
    876: "710",
    877: "693",
    878: "17",
    879: "693",
    880: "507",
    881: "186",
  };
  for (const [index, value] of Object.entries({ ...observed, ...overrides })) {
    cells[Number(index) - 1] = value;
  }
  return cells.join(",");
}

function buildStoredZip(name: string, text: string): Uint8Array {
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
  let cursor = 0;
  for (const chunk of [local, data, central, eocd]) {
    archive.set(chunk, cursor);
    cursor += chunk.length;
  }
  return archive;
}

const capturedTractResponse = JSON.stringify({
  objectIdFieldName: "OBJECTID",
  geometryType: "esriGeometryPolygon",
  features: [
    {
      attributes: {
        MSA_Code: "47764",
        MSA_Name:
          "WASHINGTON, DC-MD                                                                                                               ",
        State_Code: "11",
        State_Name: "DISTRICT OF COLUMBIA                              ",
        County_Code: "001",
        County_Name: "DISTRICT OF COLUMBIA                              ",
        Tract_Code: "9800.00",
        FIPS: "11001980000",
        Income_Indicator: "Unknown",
        DistressedTractInd: " ",
      },
    },
  ],
});

const capturedCandidateResponse = JSON.stringify({
  spatialReference: { wkid: 4326, latestWkid: 4326 },
  candidates: [
    {
      address: "1600 Pennsylvania Ave NW, Washington, District of Columbia, 20500",
      location: { x: -77.036546830571, y: 38.897675107651 },
      score: 100,
      attributes: {
        Status: "M",
        Score: 100,
        Addr_type: "PointAddress",
        DisplayX: -77.036546830571,
        DisplayY: 38.897675107651,
      },
    },
  ],
});

const servicesManifest = JSON.stringify({
  maxCensusYear: 2026,
  censusDataAvailable: "YES",
  serviceAuth: {
    clientPrefix: "public-",
    sessionHash: "browser-",
    tokenSuffix: "token",
  },
  arcgisFeatureUrls: {
    url0: "https://utility.arcgis.com/usrsvcs/servers/test/rest/services/census_tract_2026_geodemo/FeatureServer/0",
  },
  geocodeServiceUrl: "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer",
  matchScore: 98,
});

test("builds the publisher-linked annual census URLs without guessing filenames", () => {
  expect(ffiecCensusArchiveUrl(2025)).toBe(
    "https://www.ffiec.gov/sites/default/files/data/census/CensusFlatFile20255.28.26.zip",
  );
  expect(ffiecCensusArchiveUrl(2026)).toBe(
    "https://www.ffiec.gov/sites/default/files/data/cra/flat-files/CensusFlatFile2026.zip",
  );
  expect(ffiecCensusDictionaryUrl(2026)).toBe(
    "https://www.ffiec.gov/sites/default/files/data/cra/flat-files/FFIEC_Census_File_Definitions_09JULY26.xlsx",
  );
  expect(ffiecCensusPeriodEnd(2026)).toBe("2026-12-31");
  expect(() => ffiecCensusArchiveUrl(2027)).toThrow(XnewsFetchError);
});

test("builds encoded ArcGIS address and tract query URLs", () => {
  const binding = {
    geocodeServiceUrl: "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer",
    featureUrl:
      "https://utility.arcgis.com/usrsvcs/servers/test/rest/services/census_tract_2026_geodemo/FeatureServer/0",
    token: "key+with/value",
  };
  const candidate = new URL(
    ffiecGeocodeCandidateUrl("  1 Main St & Route/7, Dover, DE  ", binding),
  );
  expect(candidate.pathname).toEndWith("/findAddressCandidates");
  expect(candidate.searchParams.get("singleLine")).toBe("1 Main St & Route/7, Dover, DE");
  expect(candidate.searchParams.get("token")).toBe("key+with/value");
  expect(candidate.searchParams.get("outSR")).toBe("4326");

  const tract = new URL(ffiecGeocodeTractUrl({ longitude: -77.0365, latitude: 38.8977 }, binding));
  expect(tract.pathname).toEndWith("/query");
  expect(JSON.parse(tract.searchParams.get("geometry") ?? "null")).toEqual({
    x: -77.0365,
    y: 38.8977,
  });
  expect(tract.searchParams.get("outFields")).toContain("Tract_Code");
});

test("parses a real 2026 positional tract excerpt and preserves the complete raw row", () => {
  const fixture = censusFixture();
  const rows = parseFfiecCensusCsv(`${fixture}\r\n`, { expectedYear: 2026 });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    censusYear: 2026,
    msaMdCode: "33860",
    fipsState: "01",
    fipsCounty: "001",
    fipsTract: "020100",
    tractIncomeLevel: "middle",
    msaMdMedianFamilyIncome: 68115,
    msaMdMedianHouseholdIncome: 54250,
    tractMedianFamilyIncomePercent: 103.79,
    ffiecEstimatedMsaMdMedianFamilyIncome: 88800,
    totalPopulation: 1775,
    totalFamilies: 555,
    totalHouseholds: 693,
    totalHousingUnits: 710,
    occupiedHousingUnits: 693,
    vacantHousingUnits: 17,
    ownerOccupiedHousingUnits: 507,
    renterOccupiedHousingUnits: 186,
    distressed: false,
    underserved: false,
    warnings: [],
  });
  expect(rows[0]?.raw).toBe(fixture);
});

test("fails closed on a malformed positional header or truncated archive", async () => {
  const malformedHeader = Array<string>(FFIEC_CENSUS_FIELD_COUNT).fill("");
  malformedHeader[0] = "collection_year";
  malformedHeader[1] = "msa_md";
  expect(() => parseFfiecCensusCsv(malformedHeader.join(","))).toThrow(
    "incompatible key-field schema",
  );
  const failure = await captureError(parseFfiecCensusArchive(new Uint8Array([0x50, 0x4b, 0x03])));
  expect(failure.message).toContain("truncated or malformed");
});

test("retains rows when a numeric field cannot be coerced and names the raw value", () => {
  const row = parseFfiecCensusCsv(censusFixture({ 23: "not-a-number" }))[0];
  expect(row).toBeDefined();
  expect(row?.totalPopulation).toBeUndefined();
  expect(row?.warnings).toContain('total population: invalid numeric value "not-a-number"');
});

test("parses a captured live FFIEC tract response", () => {
  expect(parseFfiecGeocode(capturedTractResponse, 2026)).toEqual({
    censusYear: 2026,
    msaMdCode: "47764",
    msaMdName: "WASHINGTON, DC-MD",
    stateCode: "11",
    stateName: "DISTRICT OF COLUMBIA",
    countyCode: "001",
    countyName: "DISTRICT OF COLUMBIA",
    tract: "9800.00",
    fips: "11001980000",
    tractIncomeLevel: "unknown",
    distressed: false,
    warnings: [],
  });
  expect(() => parseFfiecGeocode(JSON.stringify({ results: [] }), 2026)).toThrow(
    "incompatible schema",
  );
});

test("downloads a census archive through injected transport and binds it to the data lane", async () => {
  const archive = buildStoredZip("CensusFlatFile2026.csv", `${censusFixture()}\r\n`);
  const calls: { readonly url: string; readonly userAgent: string | null }[] = [];
  const source = ffiecCensusDataSource(2026, {
    limit: 1,
    fetch: async (input, init) => {
      calls.push({
        url: fetchInputUrl(input),
        userAgent: new Headers(init?.headers).get("User-Agent"),
      });
      return new Response(archive.slice(), { headers: { "Content-Type": "application/zip" } });
    },
  });
  const result = await fetchDataRelease(source);
  expect(result.status).toBe("ok");
  expect(result.release?.asOf).toBe("2026-12-31");
  expect(result.release?.rows[0]?.fipsTract).toBe("020100");
  expect(calls).toEqual([{ url: ffiecCensusArchiveUrl(2026), userAgent: BROWSERISH_USER_AGENT }]);
  expect(FFIEC_CENSUS_ARCHIVE_MAX_BYTES).toBeGreaterThan(95_033_841);
});

test("limit zero and ifNewerThan skip census network I/O", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => {
    calls += 1;
    throw new Error("should not fetch");
  };
  expect(parseFfiecCensusCsv("not a census row", { limit: 0 })).toEqual([]);
  expect(await parseFfiecCensusArchive(new Uint8Array(), { limit: 0 })).toEqual([]);
  expect(await fetchFfiecCensus(2026, { limit: 0, fetch })).toBeUndefined();
  expect(await fetchFfiecCensus(2026, { ifNewerThan: "2026-12-31", fetch })).toBeUndefined();
  expect(calls).toBe(0);
});

test("geocodes through the live manifest shape with browser headers and no caller key", async () => {
  const calls: { readonly url: string; readonly headers: Headers }[] = [];
  const result = await fetchFfiecGeocode("1600 Pennsylvania Avenue NW, Washington, DC 20500", {
    fetch: async (input, init) => {
      const url = fetchInputUrl(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith("/assets/data/services.json")) return new Response(servicesManifest);
      if (url.includes("/findAddressCandidates?")) return new Response(capturedCandidateResponse);
      if (url.includes("/query?")) return new Response(capturedTractResponse);
      return new Response("not found", { status: 404 });
    },
  });

  expect(result).toMatchObject({
    censusYear: 2026,
    stateCode: "11",
    countyCode: "001",
    tract: "9800.00",
    matchedAddress: "1600 Pennsylvania Ave NW, Washington, District of Columbia, 20500",
    score: 100,
    longitude: -77.036546830571,
    latitude: 38.897675107651,
  });
  expect(calls).toHaveLength(3);
  expect(
    calls.every((call) => call.headers.get("Referer") === "https://geomap.ffiec.gov/ffiecgeomap/"),
  ).toBe(true);
  expect(calls.every((call) => call.headers.get("User-Agent") === BROWSERISH_USER_AGENT)).toBe(
    true,
  );
  expect(new URL(calls[1]?.url ?? "").searchParams.get("token")).toBe("public-browser-token");
});

test("blank geocode addresses fail before manifest I/O", async () => {
  let calls = 0;
  try {
    await fetchFfiecGeocode("  ", {
      fetch: async () => {
        calls += 1;
        return new Response("unexpected");
      },
    });
    throw new Error("expected a config error");
  } catch (error) {
    expect(error).toBeInstanceOf(XnewsFetchError);
    expect(error).toMatchObject({ code: "config" });
  }
  expect(calls).toBe(0);
});
