/**
 * Parse-only view of xnews: every provider's pure parser plus the shared
 * RSS/Atom machinery, the publication-date parser, and the event classifier.
 *
 * Parsers are pure and total - fixture text in, `NewsItem[]` out, no network.
 * Unlike `./catalog`, this module's import graph does include the fetch
 * layer (parsers live beside their fetchers), but nothing here dials: use it
 * with text retrieved by your own transport.
 */

export { PUBLISHED_AT_PARSER_VERSION, parsePublishedAt } from "./dates.js";
export type { ParsedPublishedAt, PublishedAtFormat } from "./dates.js";
export { classifyMarketEvent } from "./classify.js";
export type { MarketEventClassification } from "./classify.js";
export { inferNewsKind, parseAtomEntries, parseRssItems } from "./xml.js";
export type { AtomParseOptions, RssParseOptions } from "./xml.js";
export { subjectMatcher } from "./sources/match.js";
export type { SubjectMatchItem, SubjectMatchTerms } from "./sources/match.js";
export { parseCsvRecords, parseCsvTable } from "./csv.js";
export { MAX_ZIP_UNCOMPRESSED_BYTES, readZipEntries } from "./zip.js";
export type { ZipEntry } from "./zip.js";
export { excelSerialDateToIso, readXlsx } from "./xlsx.js";
export type { XlsxCell, XlsxCellValue, XlsxSheet, XlsxWorkbook } from "./xlsx.js";

export { parseAlphaVantageTranscript } from "./sources/alphavantage.js";
export type { AlphaVantageTranscript, AlphaVantageTranscriptTurn } from "./sources/alphavantage.js";
export { parseAnnasArchiveRecords } from "./sources/annasarchive.js";
export type { AnnasArchiveParseOptions } from "./sources/annasarchive.js";
export { parseArxivPapers } from "./sources/arxiv.js";
export { parseBingNews } from "./sources/bing.js";
export {
  parseBisResearchHub,
  parseBisResearchHubRecent,
  parseBisWorkingPapers,
} from "./sources/bis.js";
export { parseCourtListenerNews } from "./sources/courtlistener.js";
export { parseCotRows } from "./sources/cot.js";
export type {
  CotCitRow,
  CotDisaggregatedRow,
  CotLegacyRow,
  CotPositions,
  CotRow,
  CotTffRow,
} from "./sources/cot.js";
export { parseDtccSliceCatalog, parseDtccTradeCsv, parseDtccTradeZip } from "./sources/dtcc.js";
export type { DtccTradeEvent } from "./sources/dtcc.js";
export type { DtccSliceCatalogEntry, DtccSliceFileNameInfo } from "./sources/dtcc.urls.js";
export {
  parseFfiecBulkPage,
  parseFfiecCallBundle,
  parseFfiecFourPeriodBundle,
  parseFfiecTsvRows,
  parseFfiecUbprBundle,
} from "./sources/ffiec.js";
export type {
  FfiecBulkPage,
  FfiecCallBundle,
  FfiecFourPeriodBundle,
  FfiecFourPeriodFiling,
  FfiecInstitution,
  FfiecSchedule,
  FfiecScheduleColumn,
  FfiecScheduleFacts,
  FfiecUbprBundle,
  FfiecUbprColumn,
  FfiecUbprFiling,
  FfiecUbprKind,
  FfiecUbprReport,
} from "./sources/ffiec.js";
export { parseFederalRegisterNews } from "./sources/federalregister.js";
export { parseFinvizNews } from "./sources/finviz.js";
export { parseFixedFeedNews } from "./sources/fixedfeeds.js";
export { parseGdeltNews } from "./sources/gdelt.js";
export { parseFredObservations, parseFredSeries, parseFredSeriesSearch } from "./sources/fred.js";
export { parseGoogleNews } from "./sources/google.js";
export { parseEarningsCallTranscripts } from "./sources/hftranscripts.js";
export type {
  EarningsCallTranscript,
  EarningsCallTranscriptTurn,
} from "./sources/hftranscripts.js";
export { parseHackerNewsStories } from "./sources/hackernews.js";
export { parseInternetArchiveWorks } from "./sources/internetarchive.js";
export type { InternetArchiveParseOptions } from "./sources/internetarchive.js";
export {
  parseByteSize,
  parseLibgenBooks,
  parseLibgenDownloads,
  parsePageCount,
  parseTitleCell,
} from "./sources/libgen.js";
export type { LibgenBook, LibgenPage, LibgenParseOptions, LibgenRawRow } from "./sources/libgen.js";
export { parseMsrbEmmaDisclosures } from "./sources/msrbemma.js";
export { parseNasdaqNews } from "./sources/nasdaq.js";
export { parseOpenAlexWorks } from "./sources/openalex.js";
export type { OpenAlexWorksPage } from "./sources/openalex.js";
export { parseOpenLibraryWorks } from "./sources/openlibrary.js";
export type { OpenLibraryParseOptions } from "./sources/openlibrary.js";
export { parseSecFilings } from "./sources/sec.js";
export { parseSecCurrentFilings } from "./sources/seccurrent.js";
export { parseSecFullTextFilings } from "./sources/secfulltext.js";
export { parseSeekingAlphaNews } from "./sources/seekingalpha.js";
export { parseTickerTickNews } from "./sources/tickertick.js";
export { parseYahooFinanceNews } from "./sources/yahoo.js";
export { parseYahooSearchNews } from "./sources/yahoosearch.js";
export { parseYoutubeChannelVideos } from "./sources/youtube.js";
export {
  parseYoutubeCaptionTracks,
  parseYoutubeTranscriptSegments,
} from "./sources/youtubetranscript.js";
export {
  parseNicBulkArchive,
  parseNicBulkPage,
  parseNicInstitutions,
  parseNicRelationships,
  parseNicTransformations,
} from "./sources/nic.js";
export type {
  NicBulkPage,
  NicInstitution,
  NicPageProduct,
  NicRecord,
  NicRelationship,
  NicTransformation,
} from "./sources/nic.js";
export { parseFfiec002Report } from "./sources/ffiec002.js";
export type {
  Ffiec002CsvRow,
  Ffiec002Institution,
  Ffiec002LineItem,
  Ffiec002ParseOptions,
  Ffiec002Report,
} from "./sources/ffiec002.js";

export {
  parseCraAvailableYears,
  parseCraFlatFileArchive,
  parseCraFlatFileCatalog,
  parseCraRecord,
} from "./sources/cra.js";
export type {
  CraAggregateLenderRecordType,
  CraAggregateLenderRow,
  CraAggregateLoanRecordType,
  CraAggregateLoanRow,
  CraArchiveParseOptions,
  CraDisclosureAssessmentActivityRow,
  CraDisclosureAssessmentAreaRow,
  CraDisclosureCommunityDevelopmentRow,
  CraDisclosureLoanRecordType,
  CraDisclosureLoanRow,
  CraFlatFile,
  CraFlatFileCatalogEntry,
  CraRow,
  CraRowBase,
  CraTransmittalRow,
} from "./sources/cra.js";
export {
  parseHmdaAggregations,
  parseHmdaFilers,
  parseHmdaLoanCsv,
  parseHmdaLoanPipe,
} from "./sources/hmda.js";
export type { HmdaAggregation, HmdaFiler, HmdaLoanRecord } from "./sources/hmda.js";
export {
  parseFfiecCensusArchive,
  parseFfiecCensusCsv,
  parseFfiecGeocode,
} from "./sources/ffieccensus.js";
export type {
  FfiecCensusParseOptions,
  FfiecCensusTract,
  FfiecGeocode,
  FfiecTractIncomeLevel,
} from "./sources/ffieccensus.js";
export { parseFry9Archive, parseFry9Page, parseFry9Text } from "./sources/fry9.js";
export type { Fry9Page, Fry9ParseOptions, Fry9Period, Fry9Row } from "./sources/fry9.js";
export { parseFfiecE16Index, parseFfiecE16Workbook } from "./sources/ffiece16.js";
export type {
  FfiecE16CountryExposureRow,
  FfiecE16ExposureMeasure,
  FfiecE16MeasureName,
  FfiecE16ParseOptions,
  FfiecE16Population,
  FfiecE16RowKind,
  FfiecE16Table,
  FfiecE16Workbook,
} from "./sources/ffiece16.js";
