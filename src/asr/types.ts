export const REALTIME_ASR_SAMPLE_RATE = 16_000;
export const REALTIME_ASR_CHANNELS = 1;
export const REALTIME_ASR_BYTES_PER_SAMPLE = 2;

export type RealtimeAsrGapReason = "source" | "backend";
export type RealtimeAsrTiming = "estimated" | "model";

export interface RealtimeAsrWord {
  readonly text: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly confidence?: number;
}

export interface RealtimeAsrSpeakerSpan {
  readonly speakerId: string;
  readonly speakerIndex: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly textStart?: number;
  readonly textEnd?: number;
}

export interface RealtimeAsrUsage {
  readonly costUsd?: number;
  readonly audioSeconds?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

interface RealtimeAsrSequencedEventBase {
  readonly backend: string;
  readonly sequence: number;
  readonly generation: number;
}

interface RealtimeAsrEventBase extends RealtimeAsrSequencedEventBase {
  readonly startMs: number;
  readonly durationMs: number;
}

interface RealtimeAsrTranscriptEventBase extends RealtimeAsrEventBase {
  readonly segmentId: string;
  readonly revision: number;
  readonly text: string;
  readonly timing: RealtimeAsrTiming;
  readonly words?: readonly RealtimeAsrWord[];
  readonly speakers?: readonly RealtimeAsrSpeakerSpan[];
  readonly latencyMs?: number;
  readonly language?: string;
  readonly usage?: RealtimeAsrUsage;
}

export interface RealtimeAsrPartialEvent extends RealtimeAsrTranscriptEventBase {
  readonly type: "partial";
}

export interface RealtimeAsrFinalEvent extends RealtimeAsrTranscriptEventBase {
  readonly type: "final";
}

export interface RealtimeAsrGapEvent extends RealtimeAsrEventBase {
  readonly type: "gap";
  readonly reason: RealtimeAsrGapReason;
  readonly message: string;
  readonly recoverable: boolean;
}

export type RealtimeAsrStatusState = "ready";

export interface RealtimeAsrStatusEvent extends RealtimeAsrSequencedEventBase {
  readonly type: "status";
  readonly state: RealtimeAsrStatusState;
  readonly message?: string;
}

export type RealtimeAsrEvent =
  | RealtimeAsrPartialEvent
  | RealtimeAsrFinalEvent
  | RealtimeAsrGapEvent
  | RealtimeAsrStatusEvent;

export interface RealtimeAsrSessionOptions {
  readonly signal?: AbortSignal;
}

export interface RealtimeAsrSession extends AsyncIterable<RealtimeAsrEvent> {
  readonly backend: string;
  write(pcm: Uint8Array): Promise<void>;
  markGap(reason: RealtimeAsrGapReason, message?: string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface RealtimeAsrBackend {
  readonly id: string;
  open(options?: RealtimeAsrSessionOptions): Promise<RealtimeAsrSession>;
}

export interface TranscribePcmStreamOptions {
  readonly backend: RealtimeAsrBackend;
  readonly signal?: AbortSignal;
}
