import { normalizeDateOnly } from "../dates.js";

export type WikipediaPageviewsAccess = "all-access" | "desktop" | "mobile-app" | "mobile-web";

export interface WikipediaPageviewsUrlOptions {
  readonly project?: string;
  readonly access?: WikipediaPageviewsAccess;
  readonly date?: string | Date;
}

export const WIKIPEDIA_PAGEVIEWS_API_BASE_URL =
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/top";
export const WIKIPEDIA_DEFAULT_PROJECT = "en.wikipedia";
export const WIKIPEDIA_DEFAULT_ACCESS: WikipediaPageviewsAccess = "all-access";

/** Navigation, discussion, and maintenance namespaces that obscure article attention. */
export const WIKIPEDIA_EXCLUDED_PREFIXES: readonly string[] = [
  "Media:",
  "Special:",
  "Talk:",
  "User:",
  "User_talk:",
  "Wikipedia:",
  "Wikipedia_talk:",
  "File:",
  "File_talk:",
  "MediaWiki:",
  "MediaWiki_talk:",
  "Template:",
  "Template_talk:",
  "Help:",
  "Help_talk:",
  "Category:",
  "Category_talk:",
  "Portal:",
  "Portal_talk:",
  "Book:",
  "Book_talk:",
  "Draft:",
  "Draft_talk:",
  "Education_Program:",
  "Education_Program_talk:",
  "TimedText:",
  "TimedText_talk:",
  "Module:",
  "Module_talk:",
  "Gadget:",
  "Gadget_talk:",
  "Gadget_definition:",
  "Gadget_definition_talk:",
  "Topic:",
];

/** Resolves an explicit date, or yesterday UTC to account for Wikimedia's publication lag. */
export function wikipediaPageviewsDate(date?: string | Date): string {
  if (date === undefined) {
    return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  }
  const normalized = normalizeDateOnly(date);
  if (normalized === null) {
    throw new RangeError("date must be a valid date or ISO date-time");
  }
  return normalized;
}

export function wikipediaPageviewsUrl(options: WikipediaPageviewsUrlOptions = {}): string {
  const project = encodeURIComponent(options.project ?? WIKIPEDIA_DEFAULT_PROJECT);
  const access = encodeURIComponent(options.access ?? WIKIPEDIA_DEFAULT_ACCESS);
  const [year, month, day] = wikipediaPageviewsDate(options.date).split("-");
  return `${WIKIPEDIA_PAGEVIEWS_API_BASE_URL}/${project}/${access}/${year}/${month}/${day}`;
}
