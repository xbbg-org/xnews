import type { MarketEventKind, NewsItem } from "./types";

export interface MarketEventClassification {
  readonly eventKind?: MarketEventKind;
  readonly tags: readonly string[];
}

export function classifyMarketEvent(item: NewsItem): MarketEventClassification {
  const tags = new Set<string>();
  let eventKind: MarketEventKind | undefined;
  const text = [item.title, item.summary, item.source, item.formType, item.url]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();

  const setEventKind = (kind: MarketEventKind): void => {
    if (eventKind === undefined) eventKind = kind;
  };

  if (item.formType || item.kind === "filing") {
    eventKind = "filing";
    tags.add("filing");
    if (item.formType) tags.add(normalizeTag(item.formType));
  }

  if (containsAny(text, ["earnings", "quarter results"]) || /\bq[1-4]\s+results\b/.test(text)) {
    tags.add("earnings");
    setEventKind("earnings");
  }

  if (
    containsAny(text, [
      "appoints",
      "named chief",
      "ceo",
      "cfo",
      "board of directors",
      "resigns",
      "retires",
    ])
  ) {
    tags.add("management");
    setEventKind("management");
  }

  if (
    containsAny(text, [
      "prices",
      "offering",
      "notes due",
      "debentures",
      "senior notes",
      "subordinated",
    ])
  ) {
    tags.add("capital-markets");
    setEventKind("capital-markets");
    if (containsAny(text, ["notes", "debentures", "subordinated"])) tags.add("debt");
  }

  if (containsAny(text, ["preferred stock", "depositary shares", "preferred shares"])) {
    tags.add("preferred");
    setEventKind("preferred");
  }

  if (text.includes("dividend")) {
    tags.add("dividend");
    setEventKind("dividend");
  }

  if (containsAny(text, ["downgrade", "upgrade", "rating", "moody", "s&p", "fitch"])) {
    tags.add("rating");
    setEventKind("rating");
  }

  if (
    containsAny(text, ["regulatory", "regulator", "sec ", "federal reserve", "fdic", "doj", "ftc"])
  ) {
    tags.add("regulatory");
    setEventKind("regulatory");
  }

  if (containsAny(text, ["lawsuit", "settlement", "litigation", "court"])) {
    tags.add("legal");
    setEventKind("legal");
  }

  if (containsAny(text, ["merger", "acquisition", "acquires", "buyout", "takeover"])) {
    tags.add("mna");
    setEventKind("mna");
  }

  if (item.kind === "analysis") {
    tags.add("analysis");
    setEventKind("analysis");
  }

  if (item.kind === "press-release") {
    tags.add("press-release");
    setEventKind("press-release");
  }

  return {
    ...(eventKind ? { eventKind } : {}),
    tags: [...tags].toSorted(),
  };
}

function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}
