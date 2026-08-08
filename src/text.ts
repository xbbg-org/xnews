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

/**
 * Removes HTML tags. Quoted attribute values are consumed whole, because an
 * attribute may legally contain `>` — libgen mirrors emit
 * `<a title="… ID: 5957886<br>Vol_001" href="…">`, and a `<[^>]*>` pattern
 * ends the tag at the `<br>` and leaves the rest of the attribute behind as
 * if it were text. Quoted spans stop at a newline so one unbalanced quote in
 * malformed markup cannot swallow the rest of the document.
 */
export function stripTags(value: string): string {
  return value.replace(/<(?:[^>"']|"[^"\n]*"|'[^'\n]*')*>/g, " ");
}

/**
 * Attribute span of an opening HTML tag, with quoted values consumed whole.
 *
 * A `>` inside a quoted attribute value is legal, and catalogs emit them —
 * libgen writes `<a title="… ID: 5957886<br>Vol_001" href="…">`. A `[^>]*`
 * pattern ends the tag at that inner `>` and spills the rest of the attribute
 * into the element's text. Quoted spans stop at a newline so one unbalanced
 * quote in malformed markup cannot swallow the rest of the document.
 *
 * Compose fresh `RegExp`s from this rather than sharing a `/g/` instance:
 * `matchAll` clones its argument, but `.exec()` on a shared global regex
 * carries `lastIndex` between calls.
 */
export const TAG_ATTRIBUTES = String.raw`(?:[^>"']|"[^"\n]*"|'[^'\n]*')*`;

/** Builds a whole-element matcher: group 1 is attributes, group 2 the body. */
export function elementPattern(tag: string, flags = "gi"): RegExp {
  return new RegExp(String.raw`<${tag}\b(${TAG_ATTRIBUTES})>([\s\S]*?)</${tag}>`, flags);
}

/** Builds an opening-tag matcher: group 1 is the attribute span. */
export function openTagPattern(tag: string, flags = "i"): RegExp {
  return new RegExp(String.raw`<${tag}\b(${TAG_ATTRIBUTES})>`, flags);
}

/**
 * `"1005 Kb"`, `"1.4 MB"`, `"1 005 KiB"`, `"512 bytes"` to a byte count.
 *
 * Units are read as binary regardless of how they are spelled: catalogs label
 * 1024-byte kilobytes `kB` as often as `KiB`, so honouring the SI spelling
 * would misreport most sizes by 2.4%.
 */
export function parseByteSize(value: string): number | undefined {
  const match = /^([\d.,\s]+?)\s*(bytes?|b|kb|kib|mb|mib|gb|gib)$/i.exec(value.trim());
  if (match === null) return undefined;
  const magnitude = Number(match[1]?.replaceAll(/[\s,]/g, "") ?? "");
  if (!Number.isFinite(magnitude) || magnitude < 0) return undefined;
  const unit = (match[2] ?? "").toLowerCase();
  const scale =
    unit === "b" || unit === "byte" || unit === "bytes"
      ? 1
      : unit === "kb" || unit === "kib"
        ? 1024
        : unit === "mb" || unit === "mib"
          ? 1024 ** 2
          : 1024 ** 3;
  return Math.round(magnitude * scale);
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff)
        ? String.fromCodePoint(codePoint)
        : match;
    }

    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff)
        ? String.fromCodePoint(codePoint)
        : match;
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
