export interface SocrataResourceUrlOptions {
  readonly select?: string | readonly string[];
  readonly where?: string;
  readonly order?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly appToken?: string;
}

/** Quotes a string value for use as a SoQL literal. */
export function quoteSoqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Builds a Socrata SODA resource URL while preserving conventional query order. */
export function socrataResourceUrl(
  baseUrl: string,
  resourceId: string,
  options: SocrataResourceUrlOptions = {},
): string {
  const url = new URL(`/resource/${encodeURIComponent(resourceId)}.json`, baseUrl);
  if (options.select !== undefined) {
    const select = typeof options.select === "string" ? options.select : options.select.join(",");
    url.searchParams.set("$select", select);
  }
  if (options.where !== undefined) url.searchParams.set("$where", options.where);
  if (options.order !== undefined) url.searchParams.set("$order", options.order);
  if (options.limit !== undefined) url.searchParams.set("$limit", String(options.limit));
  if (options.offset !== undefined) url.searchParams.set("$offset", String(options.offset));
  if (options.appToken !== undefined) url.searchParams.set("$$app_token", options.appToken);
  return url.toString();
}
