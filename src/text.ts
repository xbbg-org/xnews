const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function cleanText(value: string): string {
  return stripTags(decodeEntities(decodeEntities(stripCdata(value))))
    .replace(/\s+/g, " ")
    .trim();
}

export function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

export function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return ENTITY_MAP[entity] ?? match;
  });
}

export function toAbsoluteUrl(url: string, baseUrl: string): string {
  return new URL(decodeEntities(url), baseUrl).toString();
}

export function hasAsciiControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function stripAsciiControlCharacters(value: string): string {
  if (!hasAsciiControlCharacters(value)) return value;
  let stripped = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x1f && code !== 0x7f) stripped += value.charAt(index);
  }
  return stripped;
}

/** Returns the input unchanged only when it is an absolute HTTP(S) URL. */
export function safeHttpUrl(value: string): string | undefined {
  if (!value || hasAsciiControlCharacters(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Version of the `NewsItem.id` derivation. Ids are `stableId` joins of
 * `[provider, <identity>, title]` where `<identity>` is the provider's most
 * stable per-item key: RSS guid (falling back to link), Atom accession number
 * (falling back to link), or a provider-native id. Consumers keying dedupe
 * stores on `id` can detect derivation changes by comparing this constant.
 */
export const NEWS_ITEM_ID_SCHEME_VERSION = 1;

export function stableId(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("|");
}
