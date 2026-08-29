export { createXnewsAnalyst } from "./analyst.js";
export type {
  CreateXnewsAnalystOptions,
  XnewsAnalyst,
  XnewsAnalystContextSchemaLike,
  XnewsAnalystState,
  XnewsAnalystResultSchemaLike,
  XnewsCheckpointer,
} from "./analyst.js";

export { DEFAULT_XNEWS_ARTIFACT_BYTE_CAP, sourceFetchOptions } from "./context.js";
export type {
  XnewsCredentials,
  XnewsDigestCaps,
  XnewsOcrRuntimeConfig,
  XnewsRuntimeContext,
  XnewsToolOptions,
} from "./context.js";

export { createXnewsToolOutput, redactText, redactUrl, stableStringify } from "./digest.js";
export { citationRef } from "./digest.js";
export { collectXnewsEvidence, resolveXnewsCitation } from "./evidence.js";
export type { XnewsEvidenceItem } from "./evidence.js";
export type {
  XnewsByteArtifact,
  XnewsDigestOmissions,
  XnewsToolArtifact,
  XnewsToolDigest,
} from "./digest.js";

export {
  createXnewsDataWatchNode,
  createXnewsEventWatchNode,
  createXnewsNewsNode,
  createXnewsRealtimeAsrNode,
} from "./nodes/index.js";
export type {
  XnewsDataWatchNodeOptions,
  XnewsDataWatchNodeState,
  XnewsDataWatchNodeUpdate,
  XnewsEventWatchNodeOptions,
  XnewsEventWatchNodeState,
  XnewsEventWatchNodeUpdate,
  XnewsNewsNodeOptions,
  XnewsNewsNodeState,
  XnewsNewsNodeUpdate,
  XnewsNode,
  XnewsNodeRuntime,
  XnewsRealtimeAsrChunk,
  XnewsRealtimeAsrNodeOptions,
  XnewsRealtimeAsrNodeState,
  XnewsRealtimeAsrNodeUpdate,
} from "./nodes/index.js";

export {
  XNEWS_CAPABILITY_REGISTRY,
  XNEWS_DATASETS,
  XNEWS_EVENT_PROVIDERS,
  XNEWS_NEWS_PROVIDERS,
  XNEWS_OPERATION_REGISTRY,
  XNEWS_RESEARCH_PROVIDERS,
  XNEWS_TOOL_NAMES,
  XNEWS_WORKS_PROVIDERS,
} from "./registry.js";
export type {
  XnewsCapabilityDefinition,
  XnewsDatasetCapability,
  XnewsNewsProvider,
  XnewsToolName,
} from "./registry.js";

export {
  XNEWS_MODEL_INPUT_SCHEMAS,
  XnewsAnalystResultSchema,
  XnewsCatalogInputSchema,
  XnewsDataInputSchema,
  XnewsEventsInputSchema,
  XnewsExtractInputSchema,
  XnewsFilesInputSchema,
  XnewsNewsInputSchema,
  XnewsOcrInputSchema,
  XnewsResearchInputSchema,
  XnewsRuntimeContextSchema,
  XnewsTranscribeInputSchema,
  XnewsWorksInputSchema,
  isXnewsToolName,
} from "./schemas.js";
export type {
  XnewsAnalystClaim,
  XnewsAnalystResult,
  XnewsAnalystSourceReference,
  XnewsCatalogInput,
  XnewsCompanyNewsInput,
  XnewsCompanySubject,
  XnewsDataInput,
  XnewsEventSeverity,
  XnewsEventsInput,
  XnewsExtractInput,
  XnewsExtractOperation,
  XnewsFilesInput,
  XnewsNewsInput,
  XnewsOcrInput,
  XnewsProviderDiagnostic,
  XnewsResearchInput,
  XnewsTopicNewsInput,
  XnewsTranscribeInput,
  XnewsWatchlistNewsInput,
  XnewsWorksAcrossInput,
  XnewsWorksInput,
  XnewsWorksQueryFields,
  XnewsWorksResolveInput,
  XnewsWorksSearchInput,
} from "./schemas.js";

export { projectToolSchema } from "./tool-schema.js";
export type { XnewsToolSchemaProjection } from "./tool-schema.js";

export { createXnewsTools } from "./tools/index.js";
