import { XnewsFetchError } from "../errors.js";

export const FFIEC_CENSUS_FLAT_FILES_URL = "https://www.ffiec.gov/data/census/flat-files";
export const FFIEC_GEOMAP_URL = "https://geomap.ffiec.gov/ffiecgeomap/";
export const FFIEC_GEOMAP_SERVICES_URL = `${FFIEC_GEOMAP_URL}assets/data/services.json`;

/**
 * The Drupal migration and later corrections broke the historical filename
 * pattern, so these publisher-linked URLs are a registry rather than a
 * guessed template.
 */
export const FFIEC_CENSUS_ARCHIVES = {
  2022: "https://www.ffiec.gov/sites/default/files/data/census/CensusFlatFile2022.zip",
  2023: "https://www.ffiec.gov/sites/default/files/data/census/CensusFlatFile2023.zip",
  2024: "https://www.ffiec.gov/sites/default/files/data/census/CensusFlatFile2024.zip",
  2025: "https://www.ffiec.gov/sites/default/files/data/census/CensusFlatFile20255.28.26.zip",
  2026: "https://www.ffiec.gov/sites/default/files/data/cra/flat-files/CensusFlatFile2026.zip",
} as const;
export const FFIEC_CENSUS_DICTIONARIES = {
  2022: "https://www.ffiec.gov/sites/default/files/data/census/FFIEC_Census_File_Definitions_26AUG22.xlsx",
  2023: "https://www.ffiec.gov/sites/default/files/data/census/FFIEC_Census_File_Definitions_28SEP23.xlsx",
  2024: "https://www.ffiec.gov/sites/default/files/data/census/FFIEC_Census_File_Definitions_16JULY24.xlsx",
  2025: "https://www.ffiec.gov/sites/default/files/data/census/FFIEC_Census_File_Definitions_10JULY25.xlsx",
  2026: "https://www.ffiec.gov/sites/default/files/data/cra/flat-files/FFIEC_Census_File_Definitions_09JULY26.xlsx",
} as const satisfies Record<keyof typeof FFIEC_CENSUS_ARCHIVES, string>;

export type FfiecCensusYear = keyof typeof FFIEC_CENSUS_ARCHIVES;

export const FFIEC_CENSUS_YEARS = [
  2022, 2023, 2024, 2025, 2026,
] as const satisfies readonly FfiecCensusYear[];

export function isFfiecCensusYear(value: number): value is FfiecCensusYear {
  return (FFIEC_CENSUS_YEARS as readonly number[]).includes(value);
}

export const FFIEC_GEOCODE_OUT_FIELDS = [
  "MSA_Code",
  "MSA_Name",
  "State_Code",
  "State_Name",
  "County_Code",
  "County_Name",
  "Tract_Code",
  "FIPS",
  "Income_Indicator",
  "DistressedTractInd",
] as const;

export interface FfiecGeocodeServiceBinding {
  readonly geocodeServiceUrl: string;
  readonly featureUrl: string;
  /** Public browser token assembled from the FFIEC geomap service manifest. */
  readonly token: string;
}

export interface FfiecGeocodePoint {
  readonly longitude: number;
  readonly latitude: number;
}

export function ffiecCensusArchiveUrl(year: number): string {
  if (!isFfiecCensusYear(year)) {
    throw new XnewsFetchError(
      "config",
      `FFIEC census year must be one of ${Object.keys(FFIEC_CENSUS_ARCHIVES).join(", ")}`,
      { url: FFIEC_CENSUS_FLAT_FILES_URL },
    );
  }
  return FFIEC_CENSUS_ARCHIVES[year];
}
export function ffiecCensusDictionaryUrl(year: number): string {
  if (!isFfiecCensusYear(year)) {
    throw new XnewsFetchError(
      "config",
      `FFIEC census year must be one of ${Object.keys(FFIEC_CENSUS_ARCHIVES).join(", ")}`,
      { url: FFIEC_CENSUS_FLAT_FILES_URL },
    );
  }
  return FFIEC_CENSUS_DICTIONARIES[year];
}

export function ffiecCensusPeriodEnd(year: number): string {
  ffiecCensusArchiveUrl(year);
  return `${year}-12-31`;
}

export function ffiecGeocodeCandidateUrl(
  address: string,
  binding: Pick<FfiecGeocodeServiceBinding, "geocodeServiceUrl" | "token">,
): string {
  const normalizedAddress = address.trim();
  if (normalizedAddress.length === 0) {
    throw new XnewsFetchError("config", "FFIEC geocoding requires a non-empty address", {
      url: FFIEC_GEOMAP_URL,
    });
  }

  const url = new URL(`${binding.geocodeServiceUrl.replace(/\/$/, "")}/findAddressCandidates`);
  url.searchParams.set("singleLine", normalizedAddress);
  url.searchParams.set("category", "Address");
  url.searchParams.set("maxLocations", "1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "json");
  url.searchParams.set("token", binding.token);
  return url.toString();
}

export function ffiecGeocodeTractUrl(
  point: FfiecGeocodePoint,
  binding: Pick<FfiecGeocodeServiceBinding, "featureUrl" | "token">,
): string {
  const url = new URL(`${binding.featureUrl.replace(/\/$/, "")}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("geometry", JSON.stringify({ x: point.longitude, y: point.latitude }));
  url.searchParams.set("outFields", FFIEC_GEOCODE_OUT_FIELDS.join(","));
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("token", binding.token);
  return url.toString();
}
