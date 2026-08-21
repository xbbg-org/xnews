import { XnewsFetchError } from "../errors.js";

/**
 * WFP HungerMap live food-security estimates.
 *
 * This endpoint was open when the source was written and now answers
 * anonymous callers with HTTP 401. WFP issues credentials on request rather
 * than publicly, so the source fails closed with a `config` error — surfacing
 * as lane status `disabled`, not a transport failure — until a caller supplies
 * their own `apiKey`.
 */
export const HUNGERMAP_FOOD_SECURITY_URL = "https://api.hungermapdata.org/v1/foodsecurity/country";

export interface HungerMapCredentials {
  /** WFP-issued token. Sent as an `Authorization: Bearer` header. */
  readonly apiKey?: string;
}

/**
 * Returns the authorization headers, refusing before any network I/O when no
 * credential is set. The bearer spelling follows WFP's documented scheme; it
 * cannot be exercised here because WFP issues no public credential.
 */
export function hungerMapAuthHeaders(
  credentials: HungerMapCredentials,
): Readonly<Record<string, string>> {
  const apiKey = credentials.apiKey?.trim();
  if (!apiKey) {
    throw new XnewsFetchError(
      "config",
      "WFP HungerMap withdrew anonymous access and now answers 401; set apiKey with a WFP-issued token",
      { url: HUNGERMAP_FOOD_SECURITY_URL },
    );
  }
  return { Authorization: `Bearer ${apiKey}` };
}
