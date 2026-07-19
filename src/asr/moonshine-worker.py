#!/usr/bin/env python3
"""Moonshine Voice sidecar for xnews protocol version 1."""

from __future__ import annotations

import argparse
from array import array
from collections import OrderedDict
import json
import math
from pathlib import Path
import struct
import sys
from typing import Any, BinaryIO, NoReturn

PROTOCOL_VERSION = 1
FRAME_PCM = 1
FRAME_GAP = 2
FRAME_END = 3
MAX_FRAME_BYTES = 4 * 1024 * 1024
SAMPLE_RATE = 16_000
MAX_PROCESSING_BLOCK_SAMPLES = SAMPLE_RATE // 2
MAX_TRACKED_SEGMENTS = 2_048


def emit(message: dict[str, Any]) -> None:
    print(json.dumps(message, ensure_ascii=False, separators=(",", ":")), flush=True)


def fatal(code: str, message: str) -> NoReturn:
    emit({"type": "error", "code": code, "message": message})
    raise SystemExit(1)


def read_exact(stream: BinaryIO, length: int) -> bytes | None:
    chunks = bytearray()
    while len(chunks) < length:
        chunk = stream.read(length - len(chunks))
        if not chunk:
            return None if not chunks else fatal("protocol", "Unexpected EOF inside frame")
        chunks.extend(chunk)
    return bytes(chunks)


def milliseconds(seconds: float) -> int:
    return max(0, round(seconds * 1_000))


def utf8_byte_to_utf16_index(text: str, byte_offset: int) -> int:
    prefix = text.encode("utf-8")[:byte_offset].decode("utf-8", errors="ignore")
    return len(prefix.encode("utf-16-le")) // 2


class MoonshineRuntime:
    def __init__(self, transcriber: Any, update_interval_ms: int) -> None:
        from moonshine_voice.transcriber import (
            Error,
            LineCompleted,
            LineSpeakersChanged,
            LineStarted,
            LineUpdated,
        )

        self._event_types = (LineStarted, LineUpdated, LineSpeakersChanged, LineCompleted, Error)
        self._line_started = LineStarted
        self._line_updated = LineUpdated
        self._line_speakers_changed = LineSpeakersChanged
        self._line_completed = LineCompleted
        self._error = Error
        self._transcriber = transcriber
        self._update_interval = update_interval_ms / 1_000
        self._stream: Any | None = None
        self._generation = 0
        self._generation_start_samples = 0
        self._total_samples = 0
        self._segment_states: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._start_stream()

    def _start_stream(self) -> None:
        self._stream = self._transcriber.create_stream(update_interval=self._update_interval)
        self._stream.add_listener(self._on_event)
        self._stream.start()

    def _on_event(self, event: Any) -> None:
        if not isinstance(event, self._event_types):
            return
        if isinstance(event, self._error):
            emit({"type": "error", "code": "runtime", "message": "Moonshine stream failed"})
            return
        line = event.line
        if line is None:
            return
        if isinstance(event, self._line_completed):
            self._emit_line(line, "final")
        elif isinstance(event, self._line_speakers_changed):
            self._emit_line(line, "final" if line.is_complete else "partial")
        elif isinstance(event, (self._line_started, self._line_updated)):
            if not line.is_complete:
                self._emit_line(line, "partial")

    def _emit_line(self, line: Any, kind: str) -> None:
        source_text = str(line.text or "")
        text = source_text.strip()
        if not text:
            return
        segment_id = f"moonshine:{self._generation}:{int(line.line_id)}"
        state = self._segment_states.get(segment_id)
        if kind == "partial" and state is not None and bool(state["completed"]):
            return

        generation_offset_ms = round(self._generation_start_samples * 1_000 / SAMPLE_RATE)
        words = self._words(line, generation_offset_ms)
        speakers = self._speaker_spans(line, generation_offset_ms, source_text, text)
        payload: dict[str, Any] = {
            "type": kind,
            "generation": self._generation,
            "segmentId": segment_id,
            "text": text,
            "timing": "model",
            "startMs": generation_offset_ms + milliseconds(float(line.start_time)),
            "durationMs": milliseconds(float(line.duration)),
            "latencyMs": max(0, int(line.last_transcription_latency_ms or 0)),
        }
        if words:
            payload["words"] = words
        if speakers:
            payload["speakers"] = speakers

        fingerprint = json.dumps(
            payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
        if state is not None and state["fingerprint"] == fingerprint:
            return
        revision = (int(state["revision"]) if state is not None else 0) + 1
        payload["revision"] = revision
        self._segment_states[segment_id] = {
            "revision": revision,
            "fingerprint": fingerprint,
            "completed": kind == "final" or bool(state and state["completed"]),
        }
        self._segment_states.move_to_end(segment_id)
        while len(self._segment_states) > MAX_TRACKED_SEGMENTS:
            self._segment_states.popitem(last=False)
        emit({"type": "event", "event": payload})

    def _words(self, line: Any, generation_offset_ms: int) -> list[dict[str, Any]]:
        words: list[dict[str, Any]] = []
        for word in line.words or []:
            start_ms = generation_offset_ms + milliseconds(float(word.start))
            end_ms = generation_offset_ms + milliseconds(float(word.end))
            row: dict[str, Any] = {
                "text": str(word.word),
                "startMs": start_ms,
                "durationMs": max(0, end_ms - start_ms),
            }
            confidence = float(word.confidence)
            if math.isfinite(confidence) and confidence >= 0:
                row["confidence"] = confidence
            words.append(row)
        return words

    def _speaker_spans(
        self,
        line: Any,
        generation_offset_ms: int,
        source_text: str,
        emitted_text: str,
    ) -> list[dict[str, Any]]:
        spans: list[dict[str, Any]] = []
        leading_characters = len(source_text) - len(source_text.lstrip())
        leading_bytes = len(source_text[:leading_characters].encode("utf-8"))
        emitted_bytes = len(emitted_text.encode("utf-8"))
        for span in line.speaker_spans or []:
            start_byte = max(0, min(emitted_bytes, int(span.start_char) - leading_bytes))
            end_byte = max(start_byte, min(emitted_bytes, int(span.end_char) - leading_bytes))
            spans.append(
                {
                    "speakerId": str(span.speaker_id),
                    "speakerIndex": int(span.speaker_index),
                    "startMs": generation_offset_ms + milliseconds(float(span.start_time)),
                    "durationMs": milliseconds(float(span.duration)),
                    "textStart": utf8_byte_to_utf16_index(emitted_text, start_byte),
                    "textEnd": utf8_byte_to_utf16_index(emitted_text, end_byte),
                }
            )
        return spans

    def add_pcm(self, payload: bytes) -> None:
        if len(payload) % 2 != 0:
            fatal("protocol", "PCM frame must contain complete 16-bit samples")
        samples = array("h")
        samples.frombytes(payload)
        if sys.byteorder != "little":
            samples.byteswap()
        if self._stream is None:
            fatal("runtime", "Moonshine stream is not active")
        for offset in range(0, len(samples), MAX_PROCESSING_BLOCK_SAMPLES):
            block = samples[offset : offset + MAX_PROCESSING_BLOCK_SAMPLES]
            floats = [sample / 32_768.0 for sample in block]
            self._stream.add_audio(floats, SAMPLE_RATE)
            self._total_samples += len(block)

    def mark_gap(self, reason: str, message: str) -> None:
        self._stop_stream()
        start_ms = round(self._total_samples * 1_000 / SAMPLE_RATE)
        emit(
            {
                "type": "event",
                "event": {
                    "type": "gap",
                    "generation": self._generation,
                    "startMs": start_ms,
                    "durationMs": 0,
                    "reason": reason,
                    "message": message,
                    "recoverable": True,
                },
            }
        )
        self._generation += 1
        self._generation_start_samples = self._total_samples
        self._start_stream()

    def finish(self) -> None:
        try:
            self._stop_stream()
        finally:
            self._transcriber.close()

    def _stop_stream(self) -> None:
        stream = self._stream
        if stream is None:
            return
        self._stream = None
        try:
            stream.stop()
        finally:
            stream.close()


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--protocol-version", type=int, required=True)
    parser.add_argument("--language", default="en")
    parser.add_argument("--model-arch", default="medium-streaming")
    parser.add_argument("--model-path")
    parser.add_argument("--cache-dir")
    parser.add_argument("--update-interval-ms", type=int, default=500)
    parser.add_argument("--word-timestamps", action="store_true")
    parser.add_argument("--speaker-diarization", action="store_true")
    return parser.parse_args()


def load_runtime(args: argparse.Namespace) -> MoonshineRuntime:
    try:
        from moonshine_voice import ModelArch, Transcriber, get_model_for_language
    except ImportError:
        fatal(
            "missing_dependency",
            "moonshine-voice is not installed in the configured Python environment",
        )

    if args.protocol_version != PROTOCOL_VERSION:
        fatal("protocol", "Unsupported sidecar protocol version")
    if args.update_interval_ms <= 0:
        fatal("configuration", "update interval must be positive")

    arch_name = str(args.model_arch).strip().upper().replace("-", "_")
    try:
        model_arch = getattr(ModelArch, arch_name)
    except AttributeError:
        fatal("configuration", "Unknown Moonshine model architecture")

    if args.model_path:
        model_path = str(Path(args.model_path).resolve())
    else:
        cache_root = Path(args.cache_dir).resolve() if args.cache_dir else None
        model_path, model_arch = get_model_for_language(
            str(args.language), model_arch, cache_root=cache_root
        )

    options: dict[str, str] = {}
    if args.word_timestamps:
        options["word_timestamps"] = "true"
    if args.speaker_diarization:
        options["identify_speakers"] = "true"
    transcriber = Transcriber(model_path=model_path, model_arch=model_arch, options=options)
    runtime = MoonshineRuntime(transcriber, args.update_interval_ms)
    emit(
        {
            "type": "ready",
            "protocolVersion": PROTOCOL_VERSION,
            "modelArch": str(args.model_arch),
            "language": str(args.language),
        }
    )
    return runtime


def run() -> None:
    args = parse_arguments()
    emit({"type": "status", "state": "loading"})
    runtime = load_runtime(args)
    stream = sys.stdin.buffer
    while True:
        header = read_exact(stream, 5)
        if header is None:
            fatal("protocol", "Unexpected EOF before end frame")
        frame_type, length = struct.unpack("<BI", header)
        if length > MAX_FRAME_BYTES:
            fatal("protocol", "Frame exceeds maximum size")
        payload = read_exact(stream, length)
        if payload is None:
            fatal("protocol", "Missing frame payload")
        if frame_type == FRAME_PCM:
            runtime.add_pcm(payload)
        elif frame_type == FRAME_GAP:
            try:
                gap = json.loads(payload.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                fatal("protocol", "Invalid gap payload")
            reason = gap.get("reason") if isinstance(gap, dict) else None
            message = gap.get("message") if isinstance(gap, dict) else None
            if reason not in ("source", "backend") or not isinstance(message, str):
                fatal("protocol", "Invalid gap fields")
            runtime.mark_gap(reason, message)
        elif frame_type == FRAME_END:
            if length != 0:
                fatal("protocol", "End frame must be empty")
            runtime.finish()
            emit({"type": "ended"})
            return
        else:
            fatal("protocol", "Unknown frame type")


if __name__ == "__main__":
    try:
        run()
    except SystemExit:
        raise
    except Exception:
        emit({"type": "error", "code": "runtime", "message": "Moonshine worker failed"})
        raise SystemExit(1)
