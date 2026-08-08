/**
 * FFIEC National Information Center structure-data downloads. The catalog
 * page publishes one current CSV ZIP per product and stamps each with its
 * last-refresh date.
 */

export const NIC_DATA_DOWNLOAD_URL = "https://www.ffiec.gov/npw/FinancialReport/DataDownload";
export const NIC_DATA_DICTIONARY_URL =
  "https://www.ffiec.gov/npw/StaticData/DataDownload/NPW%20Data%20Dictionary.pdf";
export const NIC_REFRESH_FAQ_URL = "https://www.ffiec.gov/npw/Help/Faq";

export type NicBulkProduct =
  | "attributes-active"
  | "attributes-closed"
  | "attributes-branches"
  | "relationships"
  | "transformations";

export type NicBulkRecordKind = "institution" | "relationship" | "transformation";

export interface NicBulkProductDefinition {
  readonly product: NicBulkProduct;
  readonly label: string;
  readonly recordKind: NicBulkRecordKind;
  readonly downloadUrl: string;
  readonly archiveName: string;
  readonly entryName: string;
  /** JavaScript action named by the catalog page's CSV button. */
  readonly pageAction: string;
}

export const NIC_BULK_PRODUCTS: readonly NicBulkProductDefinition[] = [
  {
    product: "attributes-active",
    label: "Attributes - Active",
    recordKind: "institution",
    downloadUrl: "https://www.ffiec.gov/npw/FinancialReport/ReturnAttributesActiveZipFileCSV",
    archiveName: "CSV_ATTRIBUTES_ACTIVE.zip",
    entryName: "CSV_ATTRIBUTES_ACTIVE.CSV",
    pageAction: "ReturnAttributesActiveZipFileCSV",
  },
  {
    product: "attributes-closed",
    label: "Attributes - Closed",
    recordKind: "institution",
    downloadUrl: "https://www.ffiec.gov/npw/FinancialReport/ReturnAttributesClosedZipFileCSV",
    archiveName: "CSV_ATTRIBUTES_CLOSED.zip",
    entryName: "CSV_ATTRIBUTES_CLOSED.CSV",
    pageAction: "ReturnAttributesClosedZipFileCSV",
  },
  {
    product: "attributes-branches",
    label: "Attributes - Branches",
    recordKind: "institution",
    downloadUrl: "https://www.ffiec.gov/npw/FinancialReport/ReturnAttributesBranchesZipFileCSV",
    archiveName: "CSV_ATTRIBUTES_BRANCHES.zip",
    entryName: "CSV_ATTRIBUTES_BRANCHES.CSV",
    pageAction: "ReturnAttributesBranchesZipFileCSV",
  },
  {
    product: "relationships",
    label: "Relationships",
    recordKind: "relationship",
    downloadUrl: "https://www.ffiec.gov/npw/FinancialReport/ReturnRelationshipsZipFileCSV",
    archiveName: "CSV_RELATIONSHIPS.zip",
    entryName: "CSV_RELATIONSHIPS.CSV",
    pageAction: "ReturnRelationshipsZipFileCSV",
  },
  {
    product: "transformations",
    label: "Transformations",
    recordKind: "transformation",
    downloadUrl: "https://www.ffiec.gov/npw/FinancialReport/ReturnTransformationZipFileCSV",
    archiveName: "CSV_TRANSFORMATIONS.zip",
    entryName: "CSV_TRANSFORMATIONS.CSV",
    pageAction: "ReturnTransformationZipFileCSV",
  },
] as const;

/** Resolves a public product id to its verified direct-download definition. */
export function nicBulkProductDefinition(product: string): NicBulkProductDefinition {
  const definition = NIC_BULK_PRODUCTS.find((candidate) => candidate.product === product);
  if (definition === undefined) {
    throw new RangeError(`Unknown NIC bulk product: ${product}`);
  }
  return definition;
}

/** Direct GET URL for one current CSV ZIP snapshot. */
export function nicBulkDownloadUrl(product: NicBulkProduct): string {
  return nicBulkProductDefinition(product).downloadUrl;
}
