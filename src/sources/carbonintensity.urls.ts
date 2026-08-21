export const CARBON_INTENSITY_URL = "https://api.carbonintensity.org.uk/intensity";
export const CARBON_GENERATION_URL = "https://api.carbonintensity.org.uk/generation";

export function carbonIntensityUrls(): readonly [string, string] {
  return [CARBON_INTENSITY_URL, CARBON_GENERATION_URL];
}
