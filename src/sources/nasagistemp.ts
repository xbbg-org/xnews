import { parseCsvTable } from "../csv.js";
import { fetchText } from "../http.js";
import { NASA_GISTEMP_URL, nasaGistempMonthEnd } from "./nasagistemp.urls.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";

const NASA_GISTEMP_SHAPE_ERROR = "unexpected NASA GISTEMP response shape";

export { NASA_GISTEMP_URL, nasaGistempMonthEnd } from "./nasagistemp.urls.js";

const MONTH_COLUMNS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface NasaGistempRow {
  readonly year: number;
  readonly month: number;
  readonly anomalyC?: number;
}

export interface NasaGistempAnnualMean {
  readonly year: number;
  readonly annualMeanC?: number;
}

export function parseNasaGistemp(body: string): NasaGistempRow[] {
  const table = gistempTable(body);
  const rows: NasaGistempRow[] = [];
  let yearRows = 0;
  for (const record of table) {
    const year = gistempYear(record["Year"]);
    if (year === undefined) continue;
    yearRows += 1;
    for (let index = 0; index < MONTH_COLUMNS.length; index += 1) {
      const column = MONTH_COLUMNS[index];
      if (column === undefined) continue;
      const anomalyC = gistempValue(record[column]);
      rows.push({
        year,
        month: index + 1,
        ...(anomalyC === undefined ? {} : { anomalyC }),
      });
    }
  }
  if (table.length > 0 && yearRows === 0) {
    throw new Error(NASA_GISTEMP_SHAPE_ERROR);
  }
  return rows;
}

/** Returns the published `J-D` annual mean without repeating it on monthly rows. */
export function parseNasaGistempAnnualMeans(body: string): NasaGistempAnnualMean[] {
  const table = gistempTable(body);
  const means: NasaGistempAnnualMean[] = [];
  for (const record of table) {
    const year = gistempYear(record["Year"]);
    if (year === undefined) continue;
    const annualMeanC = gistempValue(record["J-D"]);
    means.push({
      year,
      ...(annualMeanC === undefined ? {} : { annualMeanC }),
    });
  }
  if (table.length > 0 && means.length === 0) {
    throw new Error(NASA_GISTEMP_SHAPE_ERROR);
  }
  return means;
}

export async function fetchNasaGistemp(
  options: SourceFetchOptions = {},
): Promise<NasaGistempRow[]> {
  return parseNasaGistemp(await fetchText(NASA_GISTEMP_URL, options));
}

export function nasaGistempDataSource(
  options: SourceFetchOptions = {},
): DataSource<NasaGistempRow> {
  return {
    provider: "nasa-gistemp",
    dataset: "global-temp-anomaly",
    requestUrls: () => [NASA_GISTEMP_URL],
    fetchRelease: async (fetchOptions = {}): Promise<DataRelease<NasaGistempRow> | undefined> => {
      const rows = await fetchNasaGistemp({ ...options, ...fetchOptions });
      let asOf: string | undefined;
      for (const row of rows) {
        if (row.anomalyC === undefined) continue;
        const rowAsOf = nasaGistempMonthEnd(row.year, row.month);
        if (rowAsOf !== undefined && (asOf === undefined || rowAsOf > asOf)) asOf = rowAsOf;
      }
      if (asOf === undefined) return undefined;
      return {
        provider: "nasa-gistemp",
        dataset: "global-temp-anomaly",
        asOf,
        url: NASA_GISTEMP_URL,
        rows,
      };
    },
  };
}

function gistempTable(body: string): Record<string, string>[] {
  const source = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  const firstLineEnd = source.search(/\r?\n/);
  if (firstLineEnd < 0) {
    if (source.length === 0) return [];
    throw new Error(NASA_GISTEMP_SHAPE_ERROR);
  }
  const csv = source.slice(firstLineEnd).replace(/^\r?\n/, "");
  const headerEnd = csv.search(/\r?\n/);
  const headerLine = headerEnd < 0 ? csv : csv.slice(0, headerEnd);
  const columns = headerLine.split(",").map((column) => column.trim());
  if (
    columns[0] !== "Year" ||
    !MONTH_COLUMNS.every((column) => columns.includes(column)) ||
    !columns.includes("J-D")
  ) {
    throw new Error(NASA_GISTEMP_SHAPE_ERROR);
  }
  const table = parseCsvTable(csv);
  return table;
}

function gistempYear(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{4}$/.test(value.trim())) return undefined;
  const year = Number(value);
  return year >= 1000 && year <= 9999 ? year : undefined;
}

function gistempValue(value: string | undefined): number | undefined {
  const text = value?.trim();
  if (text === undefined || text.length === 0 || text === "***") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
