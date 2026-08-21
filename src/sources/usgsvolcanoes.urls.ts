export const USGS_ELEVATED_VOLCANOES_URL =
  "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes";
export const GVP_VOLCANO_WFS_URL = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows";
export const GVP_VOLCANO_TYPE_NAME = "GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes";

/**
 * Builds the Smithsonian WFS enrichment request for the USGS volcano numbers.
 * Only decimal identifiers are admitted, so upstream text cannot escape the
 * numeric CQL `IN` list.
 */
export function gvpVolcanoCoordinatesUrl(
  volcanoNumbers: readonly (string | number)[],
): string | undefined {
  const numbers = new Set<string>();
  for (const value of volcanoNumbers) {
    const normalized = String(value).trim();
    if (/^\d+$/.test(normalized)) numbers.add(normalized);
  }
  if (numbers.size === 0) return undefined;

  const url = new URL(GVP_VOLCANO_WFS_URL);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeName", GVP_VOLCANO_TYPE_NAME);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("CQL_FILTER", `Volcano_Number IN (${[...numbers].join(",")})`);
  return url.toString();
}

export function usgsVolcanoUrl(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `https://volcanoes.usgs.gov/volcanoes/${slug}/`;
}
