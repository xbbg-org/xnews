import { normalizeDateOnly } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, numberField, parseJsonRecord, recordArray, stringField } from "../json.js";
import {
  CARBON_GENERATION_URL,
  CARBON_INTENSITY_URL,
  carbonIntensityUrls,
} from "./carbonintensity.urls.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";

const GB_CARBON_INTENSITY_SHAPE_ERROR = "unexpected GB carbon intensity response shape";
const GB_CARBON_GENERATION_SHAPE_ERROR = "unexpected GB carbon generation response shape";

export {
  CARBON_GENERATION_URL,
  CARBON_INTENSITY_URL,
  carbonIntensityUrls,
} from "./carbonintensity.urls.js";

export interface CarbonIntensityRow {
  readonly from: string;
  readonly to: string;
  readonly intensityForecast?: number;
  readonly intensityActual?: number;
  readonly intensityIndex?: string;
  readonly mix: Readonly<Record<string, number>>;
}

export function parseCarbonIntensity(
  intensityBody: string,
  generationBody: string,
): CarbonIntensityRow[] {
  const intensityPayload = parseJsonRecord(intensityBody, "GB carbon intensity");
  const intensityData = intensityPayload["data"];
  if (!Array.isArray(intensityData)) {
    throw new Error(GB_CARBON_INTENSITY_SHAPE_ERROR);
  }
  const intensityRecords = recordArray(intensityData);
  if (intensityData.length > 0 && intensityRecords.length === 0) {
    throw new Error(GB_CARBON_INTENSITY_SHAPE_ERROR);
  }

  const generationPayload = parseJsonRecord(generationBody, "GB carbon generation");
  const generationData = generationPayload["data"];
  if (!isRecord(generationData) || !Array.isArray(generationData["generationmix"])) {
    throw new Error(GB_CARBON_GENERATION_SHAPE_ERROR);
  }
  const generationFrom = stringField(generationData, "from");
  const generationTo = stringField(generationData, "to");
  if (
    generationFrom === undefined ||
    generationTo === undefined ||
    normalizeDateOnly(generationFrom) === null ||
    normalizeDateOnly(generationTo) === null
  ) {
    throw new Error(GB_CARBON_GENERATION_SHAPE_ERROR);
  }
  const mix = generationMix(generationData["generationmix"]);

  const rows: CarbonIntensityRow[] = [];
  for (const record of intensityRecords) {
    const from = stringField(record, "from");
    const to = stringField(record, "to");
    if (
      from === undefined ||
      to === undefined ||
      normalizeDateOnly(from) === null ||
      normalizeDateOnly(to) === null
    ) {
      continue;
    }
    const intensity = record["intensity"];
    if (!isRecord(intensity)) continue;
    const intensityForecast = numberField(intensity, "forecast");
    const intensityActual = numberField(intensity, "actual");
    const intensityIndex = stringField(intensity, "index");
    rows.push({
      from,
      to,
      ...(intensityForecast === undefined ? {} : { intensityForecast }),
      ...(intensityActual === undefined ? {} : { intensityActual }),
      ...(intensityIndex === undefined ? {} : { intensityIndex }),
      mix,
    });
  }
  if (intensityRecords.length > 0 && rows.length === 0) {
    throw new Error(GB_CARBON_INTENSITY_SHAPE_ERROR);
  }
  return rows;
}

export async function fetchCarbonIntensity(
  options: SourceFetchOptions = {},
): Promise<CarbonIntensityRow[]> {
  const [intensityBody, generationBody] = await Promise.all([
    fetchText(CARBON_INTENSITY_URL, options),
    fetchText(CARBON_GENERATION_URL, options),
  ]);
  return parseCarbonIntensity(intensityBody, generationBody);
}

export function carbonIntensityDataSource(
  options: SourceFetchOptions = {},
): DataSource<CarbonIntensityRow> {
  return {
    provider: "uk-carbon-intensity",
    dataset: "generation-mix",
    requestUrls: () => carbonIntensityUrls(),
    fetchRelease: async (
      fetchOptions = {},
    ): Promise<DataRelease<CarbonIntensityRow> | undefined> => {
      const rows = await fetchCarbonIntensity({ ...options, ...fetchOptions });
      let asOf: string | undefined;
      for (const row of rows) {
        const rowDate = normalizeDateOnly(row.to);
        if (rowDate !== null && (asOf === undefined || rowDate > asOf)) asOf = rowDate;
      }
      if (asOf === undefined) return undefined;
      return {
        provider: "uk-carbon-intensity",
        dataset: "generation-mix",
        asOf,
        url: CARBON_INTENSITY_URL,
        rows,
      };
    },
  };
}

function generationMix(value: unknown): Readonly<Record<string, number>> {
  const entries = recordArray(value);
  const mix: Record<string, number> = {};
  for (const entry of entries) {
    const fuel = stringField(entry, "fuel")?.trim();
    const percentage = numberField(entry, "perc");
    if (fuel === undefined || fuel.length === 0 || percentage === undefined) continue;
    mix[fuel] = percentage;
  }
  if (Array.isArray(value) && value.length > 0 && Object.keys(mix).length === 0) {
    throw new Error(GB_CARBON_GENERATION_SHAPE_ERROR);
  }
  return mix;
}
