export const WORLD_BANK_DOCUMENTS_API_URL = "https://search.worldbank.org/api/v3/wds";

export interface WorldBankDocumentsUrlOptions {
  readonly docTypes?: readonly string[];
  readonly languages?: readonly string[];
  readonly rows?: number;
  readonly offset?: number;
  readonly sortBy?: string;
  readonly order?: "asc" | "desc";
  readonly since?: string;
  readonly until?: string;
  readonly fields?: readonly string[];
  readonly extraParams?: Readonly<Record<string, string>>;
}

/** Builds a World Bank Documents & Reports WDS API query URL. */
export function worldBankDocumentsUrl(
  query = "",
  options: WorldBankDocumentsUrlOptions = {},
): string {
  const url = new URL(WORLD_BANK_DOCUMENTS_API_URL);
  url.searchParams.set("format", "json");

  const normalizedQuery = query.trim();
  if (normalizedQuery) url.searchParams.set("qterm", normalizedQuery);

  appendValues(url, "docty", options.docTypes);
  appendValues(url, "lang_exact", options.languages);

  if (options.rows !== undefined) {
    url.searchParams.set("rows", String(nonNegativeInteger(options.rows, "rows")));
  }
  if (options.offset !== undefined) {
    url.searchParams.set("os", String(nonNegativeInteger(options.offset, "offset")));
  }

  setTrimmed(url, "srt", options.sortBy);
  if (options.order !== undefined) url.searchParams.set("order", options.order);
  setTrimmed(url, "strdate", options.since);
  setTrimmed(url, "enddate", options.until);

  const fields = cleanValues(options.fields);
  if (fields.length > 0) url.searchParams.set("fl", fields.join(","));

  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    if (key === "format") continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function appendValues(url: URL, key: string, values: readonly string[] | undefined): void {
  for (const value of cleanValues(values)) url.searchParams.append(key, value);
}

function cleanValues(values: readonly string[] | undefined): string[] {
  const cleaned: string[] = [];
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (normalized) cleaned.push(normalized);
  }
  return cleaned;
}

function setTrimmed(url: URL, key: string, value: string | undefined): void {
  const normalized = value?.trim();
  if (normalized) url.searchParams.set(key, normalized);
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}
