/**
 * SEC EDGAR "Latest Filings" (current events) Atom feed: the market-wide
 * stream of filings as they arrive. `company` is EDGAR's server-side
 * company-name prefix search over the current window; omit it for the
 * unfiltered stream.
 */
export function secCurrentAtomUrl(company?: string, formType?: string, count = 40): string {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcurrent");
  if (company) url.searchParams.set("company", company);
  if (formType) url.searchParams.set("type", formType);
  url.searchParams.set("count", String(Math.min(count, 100)));
  url.searchParams.set("output", "atom");
  return url.toString();
}
