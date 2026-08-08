import { hasAsciiControlCharacters } from "./text.js";
import type { ProviderErrorCode } from "./types.js";

const SENSITIVE_QUERY_KEY =
  /(?:^|[_-])(?:api[_-]?key|auth|credential|password|secret|sig(?:nature)?|token)(?:$|[_-])/i;

/** A classified xnews request failure with a credential-redacted URL. */
export class XnewsFetchError extends Error {
  readonly code: ProviderErrorCode;
  readonly url: string;
  readonly status?: number;

  constructor(
    code: ProviderErrorCode,
    message: string,
    details: { readonly url: string; readonly status?: number },
  ) {
    super(message);
    this.name = "XnewsFetchError";
    this.code = code;
    this.url = redactUrl(details.url);
    if (details.status !== undefined) this.status = details.status;
  }
}

/** Strips credentials and sensitive query values, and marks malformed URLs, for safe display. */
export function redactUrl(value: string): string {
  if (hasAsciiControlCharacters(value)) return "<invalid-url>";

  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, "<redacted>");
    }
    return url.href;
  } catch {
    return "<invalid-url>";
  }
}
