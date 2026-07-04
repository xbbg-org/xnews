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

export function stableId(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("|");
}
