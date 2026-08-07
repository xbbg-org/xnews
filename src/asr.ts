/**
 * Transcription-only view of xnews: the Moonshine and OpenRouter ASR
 * backends, realtime PCM pipeline, and YouTube realtime transcription. The
 * root entrypoint still re-exports these APIs for compatibility; this subpath
 * lets ASR-only consumers avoid bundling feed and catalog code.
 */

export { createMoonshineAsrBackend } from "./asr/moonshine.js";
export type { MoonshineAsrOptions, MoonshineModelArch } from "./asr/moonshine.js";
export { createOpenRouterAsrBackend } from "./asr/openrouter.js";
export type {
  OpenRouterAsrOptions,
  OpenRouterFailureMode,
  OpenRouterResponseFormat,
  OpenRouterTimestampGranularity,
} from "./asr/openrouter.js";
export { transcribePcmStream } from "./asr/stream.js";
export {
  REALTIME_ASR_BYTES_PER_SAMPLE,
  REALTIME_ASR_CHANNELS,
  REALTIME_ASR_SAMPLE_RATE,
} from "./asr/types.js";
export type {
  RealtimeAsrBackend,
  RealtimeAsrEvent,
  RealtimeAsrFinalEvent,
  RealtimeAsrGapEvent,
  RealtimeAsrGapReason,
  RealtimeAsrPartialEvent,
  RealtimeAsrSession,
  RealtimeAsrSessionOptions,
  RealtimeAsrSpeakerSpan,
  RealtimeAsrStatusEvent,
  RealtimeAsrStatusState,
  RealtimeAsrTiming,
  RealtimeAsrUsage,
  RealtimeAsrWord,
  TranscribePcmStreamOptions,
} from "./asr/types.js";
export { transcribeYoutubeRealtime } from "./asr/youtube.js";
export type { YoutubeRealtimeTranscriptOptions } from "./asr/youtube.js";
