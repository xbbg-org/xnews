export const GLOFAS_FLOOD_API_URL = "https://flood-api.open-meteo.com/v1/flood";
export const GLOFAS_FORECAST_DAYS = 31;
export const GLOFAS_PAST_DAYS = 31;

export interface GlofasBasin {
  readonly name: string;
  readonly countryCode?: string;
  readonly latitude: number;
  readonly longitude: number;
}

/** Gauge points selected on the named rivers at the GloFAS grid scale. */
export const GLOFAS_BASINS = [
  { name: "Amazon", countryCode: "BR", latitude: -3.13, longitude: -60.02 },
  { name: "Congo", countryCode: "CD", latitude: -4.3, longitude: 15.3 },
  { name: "Nile", countryCode: "SD", latitude: 15.6, longitude: 32.53 },
  { name: "Mississippi", countryCode: "US", latitude: 30.44, longitude: -91.19 },
  { name: "Ganges", countryCode: "IN", latitude: 25.62, longitude: 85.17 },
  { name: "Mekong", countryCode: "KH", latitude: 11.57, longitude: 104.92 },
  { name: "Yangtze", countryCode: "CN", latitude: 30.57, longitude: 114.28 },
  { name: "Danube", countryCode: "HU", latitude: 47.49, longitude: 19.05 },
  { name: "Rhine", countryCode: "DE", latitude: 50.94, longitude: 6.96 },
  { name: "Niger", countryCode: "NE", latitude: 13.52, longitude: 2.11 },
  { name: "Zambezi", countryCode: "MZ", latitude: -16.16, longitude: 33.59 },
  { name: "Indus", countryCode: "PK", latitude: 27.7, longitude: 68.85 },
  { name: "Brahmaputra", countryCode: "IN", latitude: 26.18, longitude: 91.73 },
  { name: "Volga", countryCode: "RU", latitude: 48.7, longitude: 44.5 },
  { name: "Parana", countryCode: "AR", latitude: -32.95, longitude: -60.63 },
  { name: "Murray", countryCode: "AU", latitude: -34.18, longitude: 142.16 },
  { name: "Yukon", countryCode: "CA", latitude: 64.06, longitude: -139.43 },
  { name: "Ob", countryCode: "RU", latitude: 66.53, longitude: 66.6 },
  { name: "Yenisei", countryCode: "RU", latitude: 67.47, longitude: 86.57 },
  { name: "Lena", countryCode: "RU", latitude: 62.03, longitude: 129.73 },
  { name: "Tigris-Euphrates", countryCode: "IQ", latitude: 31.05, longitude: 46.26 },
  { name: "Orinoco", countryCode: "VE", latitude: 8.13, longitude: -63.55 },
] as const satisfies readonly GlofasBasin[];

export function glofasFloodUrl(basins: readonly GlofasBasin[] = GLOFAS_BASINS): string {
  const url = new URL(GLOFAS_FLOOD_API_URL);
  url.searchParams.set("latitude", basins.map((basin) => basin.latitude).join(","));
  url.searchParams.set("longitude", basins.map((basin) => basin.longitude).join(","));
  url.searchParams.set("daily", "river_discharge");
  url.searchParams.set("forecast_days", String(GLOFAS_FORECAST_DAYS));
  url.searchParams.set("past_days", String(GLOFAS_PAST_DAYS));
  return url.toString();
}

export function glofasBasinSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
