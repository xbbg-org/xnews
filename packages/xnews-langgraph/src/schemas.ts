import { z } from "zod/v3";

import { redactText, redactUrl } from "./digest.js";
export { XnewsRuntimeContextSchema } from "./context.js";

import {
  XNEWS_NEWS_PROVIDERS,
  XNEWS_RESEARCH_PROVIDERS,
  XNEWS_TOOL_NAMES,
  type XnewsNewsProvider,
  type XnewsToolName,
} from "./registry.js";

const PositiveInteger = z.number().int().positive();
const NonnegativeInteger = z.number().int().nonnegative();
const NonemptyString = z.string().min(1).max(512);
const QueryString = z.string().min(1).max(2_000);
const RequestLimit = NonnegativeInteger.max(100);
const RequestPage = PositiveInteger.max(100);
const RequestMaxPages = PositiveInteger.max(10);
const DateBound = z.string().min(1).max(64).describe("ISO date or instant");
const HostKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u, "Expected an opaque host-bound resource key");
const AnalystText = z
  .string()
  .max(16_000)
  .transform((value) => redactText(value));
const NewsProviderSchema = z.enum(XNEWS_NEWS_PROVIDERS);
const ResearchProviderSchema = z.enum(XNEWS_RESEARCH_PROVIDERS);

export interface XnewsCompanyNewsInput {
  readonly operation: "company";
  readonly ticker: string;
  readonly companyName?: string | undefined;
  readonly cik?: string | undefined;
  readonly sources?: readonly XnewsNewsProvider[] | undefined;
  readonly limit?: number | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly secForms?: readonly string[] | undefined;
}

export interface XnewsTopicNewsInput {
  readonly operation: "topic";
  readonly query: string;
  readonly sources?: readonly XnewsNewsProvider[] | undefined;
  readonly limit?: number | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
}

export type XnewsCompanySubject =
  | {
      readonly kind: "company";
      readonly ticker: string;
      readonly companyName?: string | undefined;
      readonly cik?: string | undefined;
    }
  | {
      readonly kind: "company";
      readonly ticker?: string | undefined;
      readonly companyName: string;
      readonly cik?: string | undefined;
    }
  | {
      readonly kind: "company";
      readonly ticker?: string | undefined;
      readonly companyName?: string | undefined;
      readonly cik: string;
    };

export interface XnewsWatchlistNewsInput {
  readonly operation: "watchlist";
  readonly subjects: readonly (
    | XnewsCompanySubject
    | { readonly kind: "topic"; readonly query: string }
  )[];
  readonly sources?: readonly XnewsNewsProvider[] | undefined;
  readonly limit?: number | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
}

export type XnewsNewsInput = XnewsCompanyNewsInput | XnewsTopicNewsInput | XnewsWatchlistNewsInput;

const CompanySubjectSchema = z
  .object({
    kind: z.literal("company"),
    ticker: NonemptyString.optional(),
    companyName: NonemptyString.optional(),
    cik: NonemptyString.optional(),
  })
  .strict()
  .refine(
    (value): value is typeof value & XnewsCompanySubject =>
      value.ticker !== undefined || value.companyName !== undefined || value.cik !== undefined,
    {
      message: "A company subject requires ticker, companyName, or cik",
    },
  );

const TopicSubjectSchema = z
  .object({
    kind: z.literal("topic"),
    query: QueryString,
  })
  .strict();

export const XnewsNewsInputSchema: z.ZodType<XnewsNewsInput, z.ZodTypeDef, unknown> =
  z.discriminatedUnion("operation", [
    z
      .object({
        operation: z.literal("company"),
        ticker: NonemptyString,
        companyName: NonemptyString.optional(),
        cik: NonemptyString.optional(),
        sources: z.array(NewsProviderSchema).max(16).optional(),
        limit: RequestLimit.optional(),
        since: DateBound.optional(),
        until: DateBound.optional(),
        secForms: z.array(NonemptyString).max(32).optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("topic"),
        query: QueryString,
        sources: z.array(NewsProviderSchema).max(16).optional(),
        limit: RequestLimit.optional(),
        since: DateBound.optional(),
        until: DateBound.optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("watchlist"),
        subjects: z
          .array(z.union([CompanySubjectSchema, TopicSubjectSchema]))
          .min(1)
          .max(20),
        sources: z.array(NewsProviderSchema).max(16).optional(),
        limit: RequestLimit.optional(),
        since: DateBound.optional(),
        until: DateBound.optional(),
      })
      .strict(),
  ]);

export interface XnewsResearchInput {
  readonly operation: "search";
  readonly query: string;
  readonly providers?: readonly (typeof XNEWS_RESEARCH_PROVIDERS)[number][] | undefined;
  readonly limit?: number | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly arxivCategories?: readonly string[] | undefined;
  readonly bisInstitutions?: readonly string[] | undefined;
  readonly ssrnNetworks?: readonly ("fen" | "arn" | "ern" | number)[] | undefined;
  readonly crossrefFilters?: Readonly<Record<string, string | readonly string[]>> | undefined;
  readonly worldBankDocTypes?: readonly string[] | undefined;
  readonly bioRxivCategories?: readonly string[] | undefined;
  readonly osfProviders?: readonly string[] | undefined;
}

export const XnewsResearchInputSchema: z.ZodType<XnewsResearchInput> = z
  .object({
    operation: z.literal("search"),
    query: QueryString,
    providers: z.array(ResearchProviderSchema).max(16).optional(),
    limit: RequestLimit.optional(),
    since: DateBound.optional(),
    until: DateBound.optional(),
    arxivCategories: z.array(NonemptyString).max(16).optional(),
    bisInstitutions: z.array(NonemptyString).max(16).optional(),
    ssrnNetworks: z
      .array(z.union([z.enum(["fen", "arn", "ern"]), NonnegativeInteger]))
      .max(16)
      .optional(),
    crossrefFilters: z
      .record(NonemptyString, z.union([NonemptyString, z.array(NonemptyString).max(16)]))
      .refine((value) => Object.keys(value).length <= 16, {
        message: "crossrefFilters accepts at most 16 keys",
      })
      .optional(),
    worldBankDocTypes: z.array(NonemptyString).max(16).optional(),
    bioRxivCategories: z.array(NonemptyString).max(16).optional(),
    osfProviders: z.array(NonemptyString).max(16).optional(),
  })
  .strict();

export interface XnewsDataInput {
  readonly operation: "fetch";
  readonly source: string;
  readonly ifNewerThan?: string | undefined;
  readonly afterSequence?: number | undefined;
  readonly limit?: number | undefined;
}

export const XnewsDataInputSchema: z.ZodType<XnewsDataInput> = z
  .object({
    operation: z.literal("fetch"),
    source: HostKey.describe("Host-bound data source key"),
    ifNewerThan: DateBound.optional(),
    afterSequence: NonnegativeInteger.optional(),
    limit: RequestLimit.optional(),
  })
  .strict();

export type XnewsEventsInput =
  | {
      readonly operation: "snapshot";
      readonly source: string;
      readonly minSeverity?: XnewsEventSeverity | undefined;
      readonly countryCodes?: readonly string[] | undefined;
    }
  | {
      readonly operation: "across";
      readonly sources: readonly string[];
      readonly minSeverity?: XnewsEventSeverity | undefined;
      readonly countryCodes?: readonly string[] | undefined;
    };

export type XnewsEventSeverity = "extreme" | "severe" | "moderate" | "minor" | "unknown";
const EventSeveritySchema = z.enum(["extreme", "severe", "moderate", "minor", "unknown"]);

export const XnewsEventsInputSchema: z.ZodType<XnewsEventsInput> = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        operation: z.literal("snapshot"),
        source: HostKey.describe("Host-bound event source key"),
        minSeverity: EventSeveritySchema.optional(),
        countryCodes: z.array(z.string().length(2)).max(32).optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("across"),
        sources: z.array(HostKey).min(1).max(16),
        minSeverity: EventSeveritySchema.optional(),
        countryCodes: z.array(z.string().length(2)).max(32).optional(),
      })
      .strict(),
  ],
);

export type XnewsWorksInput =
  | XnewsWorksSearchInput
  | XnewsWorksAcrossInput
  | XnewsWorksResolveInput;

interface XnewsWorksQueryControls {
  readonly page?: number | undefined;
  readonly maxPages?: number | undefined;
  readonly limit?: number | undefined;
}

interface XnewsWorksQuerySelector {
  readonly query?: string | undefined;
  readonly title?: string | undefined;
  readonly author?: string | undefined;
  readonly isbn?: string | undefined;
  readonly doi?: string | undefined;
}

type AtLeastOne<T, Keys extends keyof T = keyof T> = Keys extends keyof T
  ? { readonly [Key in Keys]-?: Exclude<T[Key], undefined> } & Partial<Omit<T, Keys>>
  : never;

export type XnewsWorksQueryFields = XnewsWorksQueryControls & AtLeastOne<XnewsWorksQuerySelector>;

export type XnewsWorksSearchInput = XnewsWorksQueryFields & {
  readonly operation: "search";
  readonly source: string;
};

export type XnewsWorksAcrossInput = XnewsWorksQueryFields & {
  readonly operation: "across";
  readonly sources: readonly string[];
};

export interface XnewsWorksResolveInput {
  readonly operation: "resolve_identity";
  readonly source: string;
  readonly record: string;
  readonly minConfidence?: number | undefined;
  readonly maxCandidates?: number | undefined;
}

const WorksQueryShape = {
  query: QueryString.optional(),
  title: QueryString.optional(),
  author: NonemptyString.optional(),
  isbn: NonemptyString.optional(),
  doi: NonemptyString.optional(),
  page: RequestPage.optional(),
  maxPages: RequestMaxPages.optional(),
  limit: RequestLimit.optional(),
};

function hasWorksQuery<
  T extends {
    readonly query?: string | undefined;
    readonly title?: string | undefined;
    readonly author?: string | undefined;
    readonly isbn?: string | undefined;
    readonly doi?: string | undefined;
  },
>(value: T): value is T & XnewsWorksQueryFields {
  return (
    value.query !== undefined ||
    value.title !== undefined ||
    value.author !== undefined ||
    value.isbn !== undefined ||
    value.doi !== undefined
  );
}

export const XnewsWorksInputSchema: z.ZodType<XnewsWorksInput, z.ZodTypeDef, unknown> = z.union([
  z
    .object({ operation: z.literal("search"), source: HostKey, ...WorksQueryShape })
    .strict()
    .refine(hasWorksQuery, { message: "A works query field is required" }),
  z
    .object({
      operation: z.literal("across"),
      sources: z.array(HostKey).min(1).max(16),
      ...WorksQueryShape,
    })
    .strict()
    .refine(hasWorksQuery, { message: "A works query field is required" }),
  z
    .object({
      operation: z.literal("resolve_identity"),
      source: HostKey,
      record: HostKey.describe("Host-bound work record key"),
      minConfidence: z.number().min(0).max(1).optional(),
      maxCandidates: PositiveInteger.max(20).optional(),
    })
    .strict(),
]);

export type XnewsFilesInput =
  | { readonly operation: "resolve"; readonly record: string }
  | { readonly operation: "download_file"; readonly file: string };

export const XnewsFilesInputSchema: z.ZodType<XnewsFilesInput> = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("resolve"),
      record: HostKey.describe("Host-bound work record key"),
    })
    .strict(),
  z
    .object({
      operation: z.literal("download_file"),
      file: HostKey.describe("Host-bound work file key"),
    })
    .strict(),
]);

export type XnewsExtractOperation =
  | "text"
  | "pdf_text"
  | "pdf_images"
  | "djvu"
  | "xlsx"
  | "zip"
  | "csv_records"
  | "csv_table";
export interface XnewsExtractInput {
  readonly operation: XnewsExtractOperation;
  readonly artifact: string;
  readonly fileName?: string | undefined;
  readonly format?: string | undefined;
  readonly maxCharacters?: number | undefined;
}

export const XnewsExtractInputSchema: z.ZodType<XnewsExtractInput> = z
  .object({
    operation: z.enum([
      "text",
      "pdf_text",
      "pdf_images",
      "djvu",
      "xlsx",
      "zip",
      "csv_records",
      "csv_table",
    ]),
    artifact: HostKey.describe("Host-held binary artifact key"),
    fileName: NonemptyString.optional(),
    format: NonemptyString.optional(),
    maxCharacters: PositiveInteger.max(100_000).optional(),
  })
  .strict();

export type XnewsOcrInput =
  | {
      readonly operation: "images";
      readonly artifacts: readonly string[];
      readonly mediaTypes: readonly string[];
      readonly pages?: readonly number[] | undefined;
    }
  | { readonly operation: "pdf"; readonly artifact: string };

export const XnewsOcrInputSchema: z.ZodType<XnewsOcrInput> = z.union([
  z
    .object({
      operation: z.literal("images"),
      artifacts: z.array(HostKey).min(1).max(32),
      mediaTypes: z.array(NonemptyString).min(1).max(32),
      pages: z.array(PositiveInteger.max(10_000)).max(32).optional(),
    })
    .strict()
    .refine((value) => value.artifacts.length === value.mediaTypes.length, {
      message: "artifacts and mediaTypes must have equal lengths",
    })
    .refine((value) => value.pages === undefined || value.pages.length === value.artifacts.length, {
      message: "pages and artifacts must have equal lengths",
    }),
  z.object({ operation: z.literal("pdf"), artifact: HostKey }).strict(),
]);

export type XnewsTranscribeInput =
  | {
      readonly operation: "youtube_captions";
      readonly video: string;
      readonly languages?: readonly string[] | undefined;
    }
  | { readonly operation: "pcm"; readonly backend: string; readonly artifacts: readonly string[] };

export const XnewsTranscribeInputSchema: z.ZodType<XnewsTranscribeInput> = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        operation: z.literal("youtube_captions"),
        video: NonemptyString,
        languages: z.array(NonemptyString).max(16).optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("pcm"),
        backend: HostKey.describe("Host-bound realtime ASR backend key"),
        artifacts: z.array(HostKey).min(1).max(32).describe("Finite PCM chunk artifact keys"),
      })
      .strict(),
  ],
);

export type XnewsCatalogInput =
  | { readonly operation: "capabilities" }
  | {
      readonly operation: "providers";
      readonly seam?: "news" | "research" | "events" | "works" | undefined;
    }
  | { readonly operation: "datasets" }
  | {
      readonly operation: "request_data_urls";
      readonly source: string;
      readonly ifNewerThan?: string | undefined;
      readonly afterSequence?: number | undefined;
      readonly limit?: number | undefined;
    }
  | {
      readonly operation: "request_event_urls";
      readonly source: string;
      readonly minSeverity?: XnewsEventSeverity | undefined;
      readonly countryCodes?: readonly string[] | undefined;
    }
  | ({ readonly operation: "request_works_urls"; readonly source: string } & XnewsWorksQueryFields);

export const XnewsCatalogInputSchema: z.ZodType<XnewsCatalogInput, z.ZodTypeDef, unknown> = z.union(
  [
    z.object({ operation: z.literal("capabilities") }).strict(),
    z
      .object({
        operation: z.literal("providers"),
        seam: z.enum(["news", "research", "events", "works"]).optional(),
      })
      .strict(),
    z.object({ operation: z.literal("datasets") }).strict(),
    z
      .object({
        operation: z.literal("request_data_urls"),
        source: HostKey,
        ifNewerThan: DateBound.optional(),
        afterSequence: NonnegativeInteger.optional(),
        limit: RequestLimit.optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("request_event_urls"),
        source: HostKey,
        minSeverity: EventSeveritySchema.optional(),
        countryCodes: z.array(z.string().length(2)).max(32).optional(),
      })
      .strict(),
    z
      .object({
        operation: z.literal("request_works_urls"),
        source: HostKey,
        ...WorksQueryShape,
      })
      .strict()
      .refine(hasWorksQuery, { message: "A works query field is required" }),
  ],
);

export interface XnewsAnalystClaim {
  readonly statement: string;
  readonly evidence: readonly string[];
  readonly confidence: number;
}

export interface XnewsAnalystSourceReference {
  readonly id: string;
  readonly title?: string | undefined;
  readonly url?: string | undefined;
  readonly provider?: string | undefined;
}

export interface XnewsProviderDiagnostic {
  readonly provider: string;
  readonly status: "ok" | "empty" | "unsupported" | "partial" | "error" | "disabled";
  readonly warningCount: number;
  readonly errorCode?:
    | "config"
    | "network"
    | "http_status"
    | "timeout"
    | "aborted"
    | "unknown"
    | undefined;
}

export interface XnewsAnalystResult {
  readonly summary: string;
  readonly claims: readonly XnewsAnalystClaim[];
  readonly sources: readonly XnewsAnalystSourceReference[];
  readonly uncertainty: readonly string[];
  readonly limitations: readonly string[];
  readonly providerDiagnostics: readonly XnewsProviderDiagnostic[];
  readonly generatedAt: string;
}
export const XnewsAnalystResultSchema: z.ZodType<XnewsAnalystResult> = z
  .object({
    summary: AnalystText,
    claims: z
      .array(
        z
          .object({
            statement: AnalystText,
            evidence: z.array(AnalystText).max(50),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(50),
    sources: z
      .array(
        z
          .object({
            id: NonemptyString.transform((value) => redactText(value)),
            title: AnalystText.optional(),
            url: z
              .string()
              .url()
              .max(2_048)
              .transform((value) => redactUrl(value))
              .optional(),
            provider: NonemptyString.transform((value) => redactText(value)).optional(),
          })
          .strict(),
      )
      .max(100),
    uncertainty: z.array(AnalystText).max(50),
    limitations: z.array(AnalystText).max(50),
    providerDiagnostics: z
      .array(
        z
          .object({
            provider: NonemptyString.transform((value) => redactText(value)),
            status: z.enum(["ok", "empty", "unsupported", "partial", "error", "disabled"]),
            warningCount: NonnegativeInteger.max(10_000),
            errorCode: z
              .enum(["config", "network", "http_status", "timeout", "aborted", "unknown"])
              .optional(),
          })
          .strict(),
      )
      .max(100),
    generatedAt: DateBound,
  })
  .strict();

export const XNEWS_MODEL_INPUT_SCHEMAS: Readonly<Record<XnewsToolName, z.ZodType<unknown>>> = {
  xnews_news: XnewsNewsInputSchema,
  xnews_research: XnewsResearchInputSchema,
  xnews_data: XnewsDataInputSchema,
  xnews_events: XnewsEventsInputSchema,
  xnews_works: XnewsWorksInputSchema,
  xnews_files: XnewsFilesInputSchema,
  xnews_extract: XnewsExtractInputSchema,
  xnews_ocr: XnewsOcrInputSchema,
  xnews_transcribe: XnewsTranscribeInputSchema,
  xnews_catalog: XnewsCatalogInputSchema,
};

export function isXnewsToolName(value: string): value is XnewsToolName {
  return (XNEWS_TOOL_NAMES as readonly string[]).includes(value);
}
