import {
  PROVIDER_POLICIES,
  buildCompanyNewsFeedResult,
  buildTopicNewsFeedResult,
  buildWatchlistNewsFeedResult,
  downloadFile,
  extractDjvuText,
  extractPdfImages,
  extractPdfText,
  extractText,
  fetchDataRelease,
  fetchEventSnapshot,
  fetchEventsAcross,
  fetchYoutubeTranscript,
  ocrImages,
  parseCsvRecords,
  parseCsvTable,
  providerCapabilities,
  readXlsx,
  readZipEntries,
  resolveWorkFiles,
  resolveWorkIdentity,
  searchWorks,
  searchWorksAcross,
  transcribePcmStream,
  type DataFetchOptions,
  type DataSource,
  type EventFetchOptions,
  type EventSource,
  type NewsFeedOptions,
  type NewsProvider,
  type OcrOptions,
  type WorkFile,
  type WorkRecord,
  type WorksQuery,
  type WorksSource,
} from "@xbbg/xnews";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { tool, type ToolRuntime } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { collectBoundedAsync, finiteStepSignal } from "../bounded-async.js";
import {
  requireRuntimeContext,
  sourceFetchOptions,
  type XnewsRuntimeContext,
  type XnewsToolOptions,
} from "../context.js";
import { createXnewsToolOutput, failureXnewsToolOutput, redactUrl } from "../digest.js";
import {
  XNEWS_CAPABILITY_REGISTRY,
  XNEWS_DATASETS,
  XNEWS_EVENT_PROVIDERS,
  XNEWS_NEWS_PROVIDERS,
  XNEWS_RESEARCH_PROVIDERS,
  XNEWS_WORKS_PROVIDERS,
} from "../registry.js";
import {
  XnewsCatalogInputSchema,
  XnewsDataInputSchema,
  XnewsEventsInputSchema,
  XnewsExtractInputSchema,
  XnewsFilesInputSchema,
  XnewsNewsInputSchema,
  XnewsOcrInputSchema,
  XnewsResearchInputSchema,
  XnewsTranscribeInputSchema,
  XnewsWorksInputSchema,
  type XnewsCatalogInput,
  type XnewsExtractInput,
} from "../schemas.js";
import { isRecord } from "../type-guards.js";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const MAX_MODEL_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_FINITE_ASR_EVENTS = 1_000;

type DefinedInput<T> = T extends readonly (infer Item)[]
  ? readonly DefinedInput<Item>[]
  : T extends object
    ? { [Key in keyof T]: DefinedInput<Exclude<T[Key], undefined>> }
    : Exclude<T, undefined>;

interface ModelInputSchema<Output extends object> {
  parse(value: unknown): Output;
}

function parseModelInput<Output extends object>(
  schema: ModelInputSchema<Output>,
  value: unknown,
): DefinedInput<Output> {
  const input = schema.parse(value);
  removeUndefinedProperties(input);
  if (!hasNoUndefinedProperties(input))
    throw new Error("Parsed model input contains an undefined value");
  return input;
}

function removeUndefinedProperties(value: object): void {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) Reflect.deleteProperty(value, key);
    else if (typeof item === "object" && item !== null) removeUndefinedProperties(item);
  }
}

function hasNoUndefinedProperties<T>(value: T): value is T & DefinedInput<T> {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.every((item: unknown) => hasNoUndefinedProperties(item));
  if (!isRecord(value)) return true;
  return Object.values(value).every((item) => hasNoUndefinedProperties(item));
}

export function createXnewsTools(options: XnewsToolOptions = {}): StructuredToolInterface[] {
  const news = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsNewsInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        const common = newsOptions(input, context);
        const result =
          input.operation === "company"
            ? await buildCompanyNewsFeedResult({
                ...common,
                ticker: input.ticker,
                ...(input.companyName === undefined ? {} : { companyName: input.companyName }),
                ...(input.cik === undefined ? {} : { cik: input.cik }),
                ...(input.secForms === undefined ? {} : { secForms: input.secForms }),
              })
            : input.operation === "topic"
              ? await buildTopicNewsFeedResult({ ...common, query: input.query })
              : await buildWatchlistNewsFeedResult({ ...common, subjects: input.subjects });
        return createXnewsToolOutput({
          tool: "xnews_news",
          operation: input.operation,
          status: result.partial ? "partial" : result.items.length === 0 ? "empty" : "ok",
          data: result,
          items: result.items,
          warnings: result.warnings,
          sources: result.providers.flatMap((provider) => provider.requestUrls),
          counts: { items: result.items.length, providers: result.providers.length },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_news", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_news",
      description: "Fetch normalized company, topic, or watchlist news with provider diagnostics.",
      schema: toJsonSchema(XnewsNewsInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const research = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsResearchInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        const result = await buildTopicNewsFeedResult({
          ...newsOptions(input, context),
          query: input.query,
          sources: unique(input.providers ?? XNEWS_RESEARCH_PROVIDERS),
          ...(input.arxivCategories === undefined
            ? {}
            : { arxivCategories: input.arxivCategories }),
          ...(input.bisInstitutions === undefined
            ? {}
            : { bisInstitutions: input.bisInstitutions }),
          ...(input.ssrnNetworks === undefined ? {} : { ssrnNetworks: input.ssrnNetworks }),
          ...(input.crossrefFilters === undefined
            ? {}
            : { crossrefFilters: input.crossrefFilters }),
          ...(input.worldBankDocTypes === undefined
            ? {}
            : { worldBankDocTypes: input.worldBankDocTypes }),
          ...(input.bioRxivCategories === undefined
            ? {}
            : { bioRxivCategories: input.bioRxivCategories }),
          ...(input.osfProviders === undefined ? {} : { osfProviders: input.osfProviders }),
        });
        return createXnewsToolOutput({
          tool: "xnews_research",
          operation: input.operation,
          status: result.partial ? "partial" : result.items.length === 0 ? "empty" : "ok",
          data: result,
          items: result.items,
          warnings: result.warnings,
          sources: result.providers.flatMap((provider) => provider.requestUrls),
          counts: { items: result.items.length, providers: result.providers.length },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_research", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_research",
      description: "Search normalized research papers with research-provider filters.",
      schema: toJsonSchema(XnewsResearchInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const data = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsDataInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        const source = requireDataSource(context, input.source);
        const fetchOptions: DataFetchOptions = {
          ...sourceFetchOptions(context),
          ...(input.ifNewerThan === undefined ? {} : { ifNewerThan: input.ifNewerThan }),
          ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        };
        const result = await fetchDataRelease(source, fetchOptions);
        return createXnewsToolOutput({
          tool: "xnews_data",
          operation: input.operation,
          status: result.status,
          data: result,
          items: result.release?.rows ?? [],
          warnings: result.warnings,
          sources: result.requestUrls,
          counts: { rows: result.rowCount },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_data", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_data",
      description: "Fetch one release from a host-bound structured-data source.",
      schema: toJsonSchema(XnewsDataInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const events = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsEventsInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        const fetchOptions: EventFetchOptions = {
          ...sourceFetchOptions(context),
          ...(input.minSeverity === undefined ? {} : { minSeverity: input.minSeverity }),
          ...(input.countryCodes === undefined ? {} : { countryCodes: input.countryCodes }),
        };
        if (input.operation === "snapshot") {
          const result = await fetchEventSnapshot(
            requireEventSource(context, input.source),
            fetchOptions,
          );
          return createXnewsToolOutput({
            tool: "xnews_events",
            operation: input.operation,
            status: result.status,
            data: result,
            items: result.events,
            warnings: result.warnings,
            sources: result.requestUrls,
            counts: { events: result.eventCount },
            context,
            options,
          });
        }
        const result = await fetchEventsAcross(
          unique(input.sources).map((source) => requireEventSource(context, source)),
          fetchOptions,
        );
        return createXnewsToolOutput({
          tool: "xnews_events",
          operation: input.operation,
          status: aggregateStatus(result.results),
          data: result,
          items: result.events,
          warnings: result.results.flatMap((item) => item.warnings),
          sources: result.results.flatMap((item) => item.requestUrls),
          counts: { events: result.events.length, providers: result.results.length },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_events", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_events",
      description: "Fetch one active-event snapshot or merge snapshots across host-bound sources.",
      schema: toJsonSchema(XnewsEventsInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const works = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsWorksInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        if (input.operation === "resolve_identity") {
          const result = await resolveWorkIdentity(
            requireWorkRecord(context, input.record),
            requireWorksSource(context, input.source),
            {
              ...sourceFetchOptions(context),
              ...(input.minConfidence === undefined ? {} : { minConfidence: input.minConfidence }),
              ...(input.maxCandidates === undefined ? {} : { maxCandidates: input.maxCandidates }),
            },
          );
          return createXnewsToolOutput({
            tool: "xnews_works",
            operation: input.operation,
            status: result.status,
            data: result,
            items: result.candidates,
            warnings: result.warnings,
            sources: result.candidates.map((candidate) => candidate.record.url),
            counts: {
              candidates: result.candidates.length,
              matched: result.matched === undefined ? 0 : 1,
            },
            context,
            options,
          });
        }
        const query = worksQuery(input, context);
        if (input.operation === "search") {
          const result = await searchWorks(requireWorksSource(context, input.source), query);
          return createXnewsToolOutput({
            tool: "xnews_works",
            operation: input.operation,
            status: result.status,
            data: result,
            items: result.items,
            warnings: result.warnings,
            sources: result.requestUrls,
            counts: { records: result.recordCount },
            context,
            options,
          });
        }
        const result = await searchWorksAcross(
          unique(input.sources).map((source) => requireWorksSource(context, source)),
          query,
        );
        return createXnewsToolOutput({
          tool: "xnews_works",
          operation: input.operation,
          status: aggregateStatus(result.results),
          data: result,
          items: result.items,
          warnings: result.results.flatMap((item) => item.warnings),
          sources: result.results.flatMap((item) => item.requestUrls),
          counts: { records: result.items.length, providers: result.results.length },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_works", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_works",
      description: "Search host-bound work catalogs or resolve bibliographic identity.",
      schema: toJsonSchema(XnewsWorksInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const files = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsFilesInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        const fileOptions = {
          ...sourceFetchOptions(context),
          maxResponseBytes: Math.min(
            context.maxResponseBytes ?? MAX_MODEL_DOWNLOAD_BYTES,
            MAX_MODEL_DOWNLOAD_BYTES,
          ),
          ...(context.credentials?.annasArchiveKey === undefined
            ? {}
            : { annasArchiveKey: context.credentials.annasArchiveKey }),
          ...(context.mirrors === undefined ? {} : { mirrors: context.mirrors }),
        };
        if (input.operation === "resolve") {
          const result = await resolveWorkFiles(
            requireWorkRecord(context, input.record),
            fileOptions,
          );
          return createXnewsToolOutput({
            tool: "xnews_files",
            operation: input.operation,
            status: result.length === 0 ? "empty" : "ok",
            data: result,
            items: result,
            sources: result.map((item) => item.url),
            counts: { files: result.length },
            context,
            options,
          });
        }
        const result = await downloadFile(requireWorkFile(context, input.file), fileOptions);
        return createXnewsToolOutput({
          tool: "xnews_files",
          operation: input.operation,
          status: "ok",
          data: result,
          items: [
            {
              fileName: result.fileName,
              contentType: result.contentType,
              sizeBytes: result.sizeBytes,
            },
          ],
          sources: [result.url],
          counts: { bytes: result.sizeBytes },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_files", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_files",
      description: "Resolve work files or download a bounded file into the host-only artifact.",
      schema: toJsonSchema(XnewsFilesInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const extract = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsExtractInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        const bytes = requireBinaryArtifact(context, input.artifact);
        let result: unknown;
        if (input.operation === "text") {
          result = await extractText(
            { bytes, ...(input.fileName === undefined ? {} : { fileName: input.fileName }) },
            {
              ...(input.format === undefined ? {} : { format: input.format }),
              ...(input.maxCharacters === undefined ? {} : { maxCharacters: input.maxCharacters }),
              ...(context.ocr === undefined ? {} : { ocr: ocrRuntimeOptions(context) }),
            },
          );
        } else if (input.operation === "pdf_text") result = await extractPdfText(bytes);
        else if (input.operation === "pdf_images") result = await extractPdfImages(bytes);
        else if (input.operation === "djvu") result = await extractDjvuText(bytes);
        else if (input.operation === "xlsx") result = await readXlsx(bytes, input.fileName);
        else if (input.operation === "zip") result = await readZipEntries(bytes, input.fileName);
        else {
          const text = utf8.decode(bytes);
          result = input.operation === "csv_records" ? parseCsvRecords(text) : parseCsvTable(text);
        }
        const items = extractItems(input.operation, result);
        return createXnewsToolOutput({
          tool: "xnews_extract",
          operation: input.operation,
          status: items.length === 0 ? "empty" : "ok",
          data: result,
          items,
          counts: { items: items.length },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_extract", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_extract",
      description: "Parse a host-held document, archive, spreadsheet, or CSV artifact.",
      schema: toJsonSchema(XnewsExtractInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const ocr = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsOcrInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        const images =
          input.operation === "images"
            ? input.artifacts.map((artifact, index) => ({
                bytes: requireBinaryArtifact(context, artifact),
                mediaType: input.mediaTypes[index]!,
                ...(input.pages?.[index] === undefined ? {} : { page: input.pages[index] }),
              }))
            : (await extractPdfImages(requireBinaryArtifact(context, input.artifact))).images;
        const result = await ocrImages(images, ocrRuntimeOptions(context));
        return createXnewsToolOutput({
          tool: "xnews_ocr",
          operation: input.operation,
          status:
            result.pages.length === 0 ? "empty" : result.warnings.length > 0 ? "partial" : "ok",
          data: result,
          items: result.pages,
          warnings: result.warnings,
          counts: { pages: result.pages.length, characters: result.text.length },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_ocr", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_ocr",
      description: "OCR host-held images or PDF pages using host-controlled service configuration.",
      schema: toJsonSchema(XnewsOcrInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const transcribe = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsTranscribeInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        if (input.operation === "youtube_captions") {
          const result = await fetchYoutubeTranscript(input.video, {
            ...sourceFetchOptions(context),
            ...(input.languages === undefined ? {} : { languages: input.languages }),
          });
          return createXnewsToolOutput({
            tool: "xnews_transcribe",
            operation: input.operation,
            status: result.segments.length === 0 ? "empty" : "ok",
            data: result,
            items: result.segments,
            sources: [`https://www.youtube.com/watch?v=${result.videoId}`],
            counts: { segments: result.segments.length, characters: result.text.length },
            context,
            options,
          });
        }
        const backend = context.realtimeAsrBackends?.[input.backend];
        if (backend === undefined)
          throw new Error(`No realtime ASR backend is bound as ${input.backend}`);
        const artifactKeys = unique(input.artifacts);
        const chunks = artifactKeys.map((artifact) => requireBinaryArtifact(context, artifact));
        const signal = finiteStepSignal(context.signal, context.timeoutMs);
        const collected = await collectBoundedAsync(
          transcribePcmStream(finiteChunks(chunks), { backend, signal }),
          MAX_FINITE_ASR_EVENTS,
          signal,
        );
        const result = collected.items;
        const truncated = collected.truncated;
        return createXnewsToolOutput({
          tool: "xnews_transcribe",
          operation: input.operation,
          status: truncated ? "partial" : "ok",
          data: result,
          items: result,
          ...(truncated
            ? { warnings: [`ASR output capped at ${MAX_FINITE_ASR_EVENTS} events`] }
            : {}),
          counts: { events: result.length, chunks: chunks.length },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_transcribe", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_transcribe",
      description: "Fetch finite YouTube captions or transcribe finite host-held PCM chunks.",
      schema: toJsonSchema(XnewsTranscribeInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  const catalog = tool(
    async (value, runtime: ToolRuntime<unknown, XnewsRuntimeContext>) => {
      const input = parseModelInput(XnewsCatalogInputSchema, value);
      const context = requireRuntimeContext(runtime.context);
      try {
        const result = catalogResult(input, context);
        const items = Array.isArray(result) ? result : [result];
        return createXnewsToolOutput({
          tool: "xnews_catalog",
          operation: input.operation,
          status: items.length === 0 ? "empty" : "ok",
          data: result,
          items,
          counts: { items: items.length },
          context,
          options,
        });
      } catch (error) {
        return failureXnewsToolOutput("xnews_catalog", input.operation, error, context, options);
      }
    },
    {
      name: "xnews_catalog",
      description:
        "Inspect capabilities, providers, datasets, host-bound sources, or redacted URL previews.",
      schema: toJsonSchema(XnewsCatalogInputSchema),
      responseFormat: "content_and_artifact",
    },
  );

  return [news, research, data, events, works, files, extract, ocr, transcribe, catalog];
}

function newsOptions(
  input: {
    readonly sources?: readonly NewsProvider[];
    readonly limit?: number;
    readonly since?: string;
    readonly until?: string;
  },
  context: XnewsRuntimeContext,
): NewsFeedOptions {
  return {
    ...sourceFetchOptions(context),
    ...(input.sources === undefined ? {} : { sources: unique(input.sources) }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.since === undefined ? {} : { since: input.since }),
    ...(input.until === undefined ? {} : { until: input.until }),
    ...(context.credentials?.openAlexApiKey === undefined
      ? {}
      : { openAlexApiKey: context.credentials.openAlexApiKey }),
  };
}

function worksQuery(
  input: {
    readonly query?: string;
    readonly title?: string;
    readonly author?: string;
    readonly isbn?: string;
    readonly doi?: string;
    readonly page?: number;
    readonly maxPages?: number;
    readonly limit?: number;
  },
  context: XnewsRuntimeContext,
): WorksQuery {
  return {
    ...sourceFetchOptions(context),
    ...(input.query === undefined ? {} : { query: input.query }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.author === undefined ? {} : { author: input.author }),
    ...(input.isbn === undefined ? {} : { isbn: input.isbn }),
    ...(input.doi === undefined ? {} : { doi: input.doi }),
    ...(input.page === undefined ? {} : { page: input.page }),
    ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

function requireDataSource(context: XnewsRuntimeContext, key: string): DataSource<unknown> {
  const source = context.dataSources?.[key];
  if (source === undefined) throw new Error(`No data source is bound as ${key}`);
  return source;
}

function requireEventSource(context: XnewsRuntimeContext, key: string): EventSource<string> {
  const source = context.eventSources?.[key];
  if (source === undefined) throw new Error(`No event source is bound as ${key}`);
  return source;
}

function requireWorksSource(context: XnewsRuntimeContext, key: string): WorksSource {
  const source = context.worksSources?.[key];
  if (source === undefined) throw new Error(`No works source is bound as ${key}`);
  return source;
}

function requireWorkRecord(context: XnewsRuntimeContext, key: string): WorkRecord {
  const record = context.workRecords?.[key];
  if (record === undefined) throw new Error(`No work record is bound as ${key}`);
  return record;
}

function requireWorkFile(context: XnewsRuntimeContext, key: string): WorkFile {
  const file = context.workFiles?.[key];
  if (file === undefined) throw new Error(`No work file is bound as ${key}`);
  return file;
}

function requireBinaryArtifact(context: XnewsRuntimeContext, key: string): Uint8Array {
  const artifact = context.binaryArtifacts?.[key];
  if (artifact === undefined) throw new Error(`No binary artifact is bound as ${key}`);
  return artifact;
}

function ocrRuntimeOptions(context: XnewsRuntimeContext): OcrOptions {
  if (context.ocr === undefined) throw new Error("OCR runtime configuration is not bound");
  return {
    ...sourceFetchOptions(context),
    ...context.ocr,
  };
}

function aggregateStatus(results: readonly { readonly status: string }[]): string {
  if (results.every((result) => result.status === "empty")) return "empty";
  if (results.every((result) => result.status === "ok" || result.status === "empty")) return "ok";
  if (results.every((result) => result.status === "disabled")) return "disabled";
  if (results.every((result) => result.status === "unsupported")) return "unsupported";
  if (results.every((result) => result.status === "error")) return "error";
  return "partial";
}

function extractItems(
  operation: XnewsExtractInput["operation"],
  result: unknown,
): readonly unknown[] {
  if (Array.isArray(result)) return result;
  if (!isRecord(result)) return [result];
  if (Array.isArray(result["sections"])) return result["sections"];
  if (Array.isArray(result["pages"])) return result["pages"];
  if (Array.isArray(result["images"])) return result["images"];
  if (Array.isArray(result["sheets"])) return result["sheets"];
  return [{ operation, ...result }];
}

async function* finiteChunks(chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function catalogResult(input: XnewsCatalogInput, context: XnewsRuntimeContext): unknown {
  if (input.operation === "capabilities") return XNEWS_CAPABILITY_REGISTRY;
  if (input.operation === "datasets") return XNEWS_DATASETS;
  if (input.operation === "providers") {
    if (input.seam === "news") return XNEWS_NEWS_PROVIDERS;
    if (input.seam === "research") return XNEWS_RESEARCH_PROVIDERS;
    if (input.seam === "events") return XNEWS_EVENT_PROVIDERS;
    if (input.seam === "works") return XNEWS_WORKS_PROVIDERS;
    return {
      news: XNEWS_NEWS_PROVIDERS,
      research: XNEWS_RESEARCH_PROVIDERS,
      events: XNEWS_EVENT_PROVIDERS,
      works: XNEWS_WORKS_PROVIDERS,
      policies: PROVIDER_POLICIES,
      newsCapabilities: Object.fromEntries(
        XNEWS_NEWS_PROVIDERS.map((provider) => [provider, providerCapabilities(provider)]),
      ),
    };
  }
  if (input.operation === "request_data_urls") {
    const source = requireDataSource(context, input.source);
    const urls = source.requestUrls({
      ...sourceFetchOptions(context),
      ...(input.ifNewerThan === undefined ? {} : { ifNewerThan: input.ifNewerThan }),
      ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    return urls.map((url) => redactUrl(url));
  }
  if (input.operation === "request_event_urls") {
    const source = requireEventSource(context, input.source);
    const urls = source.requestUrls({
      ...sourceFetchOptions(context),
      ...(input.minSeverity === undefined ? {} : { minSeverity: input.minSeverity }),
      ...(input.countryCodes === undefined ? {} : { countryCodes: input.countryCodes }),
    });
    return urls.map((url) => redactUrl(url));
  }
  const source = requireWorksSource(context, input.source);
  return source.requestUrls(worksQuery(input, context)).map((url) => redactUrl(url));
}
