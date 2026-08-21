export const NASA_GISTEMP_URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv";

export function nasaGistempMonthEnd(year: number, month: number): string | undefined {
  if (
    !Number.isInteger(year) ||
    year < 1000 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return undefined;
  }
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
