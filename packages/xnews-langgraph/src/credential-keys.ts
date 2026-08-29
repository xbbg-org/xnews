/**
 * Recognizes field names that hold a credential.
 *
 * Substring matching is wrong here: it blanks `secretary`, `tokenCount`, and `cookieBanner`,
 * which are ordinary record fields, and every value that genuinely belongs to the operator is
 * already redacted by value through `runtimeSecretValues`. A name qualifies only when its last
 * word is a credential word.
 */
const CREDENTIAL_WORDS: Readonly<Record<string, true>> = {
  apikey: true,
  authorization: true,
  bearer: true,
  cookie: true,
  credential: true,
  credentials: true,
  password: true,
  secret: true,
  secrets: true,
  session: true,
  signature: true,
  token: true,
  tokens: true,
};

/** True for `apiKey`, `access_token`, and `clientSecret`; false for `secretary` and `tokenCount`. */
export function isSensitiveDataKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
  const last = words.at(-1);
  if (last === undefined) return false;
  if (last in CREDENTIAL_WORDS) return true;
  // `apiKey` and `api_key` both split into `api` + `key`.
  return words.length >= 2 && `${words.at(-2) ?? ""}${last}` in CREDENTIAL_WORDS;
}
