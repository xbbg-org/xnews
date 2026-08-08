export type BioRxivServer = "biorxiv" | "medrxiv";

export const BIORXIV_API_ORIGIN = "https://api.biorxiv.org";

export interface BioRxivDetailsUrlOptions {
  readonly from: string;
  readonly to: string;
  readonly cursor?: number;
}

/** Builds one page of the bioRxiv/medRxiv preprint details API. */
export function bioRxivDetailsUrl(
  server: BioRxivServer,
  options: BioRxivDetailsUrlOptions,
): string {
  if (server !== "biorxiv" && server !== "medrxiv") {
    throw new TypeError("server must be biorxiv or medrxiv");
  }

  const from = requireDate(options.from, "from");
  const to = requireDate(options.to, "to");
  if (from > to) throw new RangeError("from must be before or equal to to");

  const cursor = options.cursor ?? 0;
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new RangeError("cursor must be a non-negative integer");
  }

  return `${BIORXIV_API_ORIGIN}/details/${server}/${from}/${to}/${cursor}/json`;
}

function requireDate(value: string, name: "from" | "to"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${name} must use YYYY-MM-DD format`);
  }
  return value;
}
