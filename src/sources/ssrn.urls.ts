export const SSRN_NETWORKS = {
  fen: 203,
  arn: 204,
  ern: 205,
} as const;

export type SsrnNetwork = keyof typeof SSRN_NETWORKS | number;

export interface SsrnPapersUrlOptions {
  readonly index?: number;
  readonly count?: number;
  /** `0` requests the most recently approved papers. */
  readonly sort?: number;
}

const SSRN_API_ORIGIN = "https://api.ssrn.com";

/**
 * Builds a URL for an UNOFFICIAL, undocumented Elsevier endpoint that may
 * change or be restricted at any time. Binding ids for other SSRN networks can
 * be found in the network landing-page HTML on ssrn.com.
 */
export function ssrnPapersUrl(network: SsrnNetwork, options: SsrnPapersUrlOptions = {}): string {
  const bindingId = resolveSsrnBindingId(network);
  const index = nonNegativeInteger(options.index ?? 0, "index");
  const count = nonNegativeInteger(options.count ?? 50, "count");
  const sort = nonNegativeInteger(options.sort ?? 0, "sort");
  const url = new URL(`${SSRN_API_ORIGIN}/content/v1/bindings/${bindingId}/papers`);
  url.searchParams.set("index", String(index));
  url.searchParams.set("count", String(count));
  url.searchParams.set("sort", String(sort));
  return url.toString();
}

export function resolveSsrnBindingId(network: SsrnNetwork): number {
  if (typeof network === "number") {
    if (Number.isInteger(network) && network > 0) return network;
    throw new TypeError("SSRN binding id must be a positive integer");
  }

  if (Object.hasOwn(SSRN_NETWORKS, network)) {
    return SSRN_NETWORKS[network];
  }
  throw new TypeError(`Unknown SSRN network: ${network}`);
}

function nonNegativeInteger(value: number, name: string): number {
  if (Number.isInteger(value) && value >= 0) return value;
  throw new RangeError(`${name} must be a non-negative integer`);
}
