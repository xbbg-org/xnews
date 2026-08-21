export const CAISO_FUEL_SOURCE_URL = "https://www.caiso.com/outlook/current/fuelsource.csv";
export const CAISO_TIME_ZONE = "America/Los_Angeles";

export function caisoPacificDate(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("date must be valid");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CAISO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      values[part.type] = part.value;
    }
  }
  const year = values["year"];
  const month = values["month"];
  const day = values["day"];
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("unable to derive the Pacific calendar date");
  }
  return `${year}-${month}-${day}`;
}
