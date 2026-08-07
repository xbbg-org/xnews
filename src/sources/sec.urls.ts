export function secCompanyAtomUrl(identifier: string, formType?: string, count = 40): string {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcompany");
  url.searchParams.set("CIK", identifier.toUpperCase());
  if (formType) url.searchParams.set("type", formType);
  url.searchParams.set("count", String(count));
  url.searchParams.set("output", "atom");
  return url.toString();
}
