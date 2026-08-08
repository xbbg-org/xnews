export const CRA_FLAT_FILES_PAGE_URL = "https://www.ffiec.gov/data/cra/flat-files";
export const CRA_DATA_PRODUCTS_URL = "https://www.ffiec.gov/data/cra/data-products";
export const CRA_DISCLAIMER_URL = "https://www.ffiec.gov/disclaimer";

export const CRA_FLAT_FILE_KINDS = [
  {
    kind: "transmittal",
    label: "Transmittal sheet",
    fromYear: 1996,
    throughYear: 2024,
    archiveSuffix: "trans",
    specsSuffix: "Trans",
    archiveFormat: "zip",
    recordFormat: "fixed-width",
  },
  {
    kind: "aggregate",
    label: "Aggregate data",
    fromYear: 1996,
    throughYear: 2024,
    archiveSuffix: "aggr",
    specsSuffix: "Agg",
    archiveFormat: "zip",
    recordFormat: "fixed-width",
  },
  {
    kind: "disclosure",
    label: "Disclosure data",
    fromYear: 1996,
    throughYear: 2024,
    archiveSuffix: "discl",
    specsSuffix: "Disc",
    archiveFormat: "zip",
    recordFormat: "fixed-width",
  },
] as const;

export type CraFlatFileKind = (typeof CRA_FLAT_FILE_KINDS)[number]["kind"];
export type CraFlatFileDefinition = (typeof CRA_FLAT_FILE_KINDS)[number];

export const CRA_FLAT_FILE_YEARS = [
  2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010, 2009,
  2008, 2007, 2006, 2005, 2004, 2003, 2002, 2001, 2000, 1999, 1998, 1997, 1996,
] as const;

export function craFlatFileDefinition(kind: CraFlatFileKind): CraFlatFileDefinition {
  const definition = CRA_FLAT_FILE_KINDS.find((candidate) => candidate.kind === kind);
  if (definition === undefined) {
    throw new RangeError(`Unknown CRA flat-file kind: ${kind}`);
  }
  return definition;
}

export function craFlatFileUrl(year: number, kind: CraFlatFileKind): string {
  const definition = craFlatFileDefinition(kind);
  validateYear(year, definition);
  const shortYear = String(year).slice(-2);
  return `https://www.ffiec.gov/sites/default/files/data/cra/flat-files/${shortYear}exp_${definition.archiveSuffix}.zip`;
}

export function craFlatFileSpecsUrl(year: number, kind: CraFlatFileKind): string {
  const definition = craFlatFileDefinition(kind);
  validateYear(year, definition);
  const shortYear = String(year).slice(-2);
  return `https://www.ffiec.gov/sites/default/files/data/cra/flat-files/${shortYear}Flat${definition.specsSuffix}Specs.pdf`;
}

function validateYear(year: number, definition: CraFlatFileDefinition): void {
  if (!Number.isInteger(year) || year < definition.fromYear || year > definition.throughYear) {
    throw new RangeError(
      `CRA ${definition.kind} year must be an integer from ${definition.fromYear} through ${definition.throughYear}; received ${String(year)}`,
    );
  }
}
