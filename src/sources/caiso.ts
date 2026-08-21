import { parseCsvTable } from "../csv.js";
import { fetchText } from "../http.js";
import { CAISO_FUEL_SOURCE_URL, caisoPacificDate } from "./caiso.urls.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";

const CAISO_SHAPE_ERROR = "unexpected CAISO fuel source response shape";

export { CAISO_FUEL_SOURCE_URL, CAISO_TIME_ZONE, caisoPacificDate } from "./caiso.urls.js";

export interface CaisoFuelMixRow {
  readonly time: string;
  readonly fuels: Readonly<Record<string, number>>;
}

export interface CaisoFuelMixFetchOptions extends SourceFetchOptions {
  /** Pins the Pacific calendar date used to label the current-day CSV release. */
  readonly now?: Date;
}

export function parseCaisoFuelMix(body: string): CaisoFuelMixRow[] {
  const source = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  if (source.length === 0) return [];
  const headerEnd = source.search(/\r?\n/);
  const headerLine = headerEnd < 0 ? source : source.slice(0, headerEnd);
  const headerColumns = headerLine.split(",");
  if (headerColumns.length < 2 || headerColumns[0]?.trim() !== "Time") {
    throw new Error(CAISO_SHAPE_ERROR);
  }
  const table = parseCsvTable(source);
  const rows: CaisoFuelMixRow[] = [];
  let sawNonblankFuelCell = false;

  for (const record of table) {
    if (!Object.hasOwn(record, "Time")) {
      throw new Error(CAISO_SHAPE_ERROR);
    }
    const time = record["Time"]?.trim() ?? "";
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;

    const fuels: Record<string, number> = {};
    for (const [fuel, rawValue] of Object.entries(record)) {
      if (fuel === "Time") continue;
      const valueText = rawValue.trim();
      if (valueText.length === 0) continue;
      sawNonblankFuelCell = true;
      const value = Number(valueText);
      if (Number.isFinite(value)) fuels[fuel] = value;
    }
    if (Object.keys(fuels).length > 0) rows.push({ time, fuels });
  }

  if (sawNonblankFuelCell && rows.length === 0) {
    throw new Error(CAISO_SHAPE_ERROR);
  }
  return rows;
}

export async function fetchCaisoFuelMix(
  options: SourceFetchOptions = {},
): Promise<CaisoFuelMixRow[]> {
  return parseCaisoFuelMix(await fetchText(CAISO_FUEL_SOURCE_URL, options));
}

export function caisoFuelMixDataSource(
  options: CaisoFuelMixFetchOptions = {},
): DataSource<CaisoFuelMixRow> {
  return {
    provider: "caiso-fuel-mix",
    dataset: "fuel-source",
    requestUrls: () => [CAISO_FUEL_SOURCE_URL],
    fetchRelease: async (fetchOptions = {}): Promise<DataRelease<CaisoFuelMixRow> | undefined> => {
      const rows = await fetchCaisoFuelMix({ ...options, ...fetchOptions });
      if (rows.length === 0) return undefined;
      return {
        provider: "caiso-fuel-mix",
        dataset: "fuel-source",
        asOf: caisoPacificDate(options.now),
        url: CAISO_FUEL_SOURCE_URL,
        rows,
      };
    },
  };
}
