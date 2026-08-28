# Changelog

All notable changes to `@xbbg/xnews-langgraph` are documented in this file.

## [Unreleased]

### Breaking

- Removed the `download_work` file operation. It accepted a work record and followed a provider-selected URL, letting the model reach an origin no host had approved. Resolution and download are now separate acts: `resolve` returns candidates for host review, and the host must bind an approved `WorkFile` under `workFiles` before `download_file` can run.

### Fixed

- Node updates now redact by key name, not only by matching operator secret values. A key such as `authorization`, `cookie`, `email`, or `phone` is replaced with `[REDACTED]` at every depth, so provider payloads can no longer carry operator PII or credentials into checkpointed state. A `structuredClone` failure inside redaction is also redacted instead of propagating raw values.
- Realtime ASR collection is bounded in both work and time. Each step accepts at most `maxEventsPerStep` events (4,000 by default, hard-capped at 10,000) and runs under `context.timeoutMs` as an invocation deadline (30 seconds by default, capped at two minutes), raced against providers that ignore abort signals. A step that overflows or times out throws without consuming its queued chunks, so a resumed checkpoint replays them. A stream that ends exactly at the cap omitted nothing and is reported as complete.
- Tightened runtime context guards so a malformed `WorkRecord` or `WorkFile` is rejected at the boundary: author and warning arrays must hold strings, provenance entries must carry a provider and URL, identity confidence must be a finite value in `[0, 1]`, and availability must be one of the known states.

### Added

- `createXnewsAnalyst` now infers its structured result type from the supplied `resultSchema` across both supported Zod majors, so a caller-provided schema yields a typed `structuredResponse` instead of the default union. Exported `XnewsAnalystContextSchemaLike` and `XnewsAnalystResultSchemaLike` for callers that wrap the factory.
- `XnewsRealtimeAsrNodeOptions.maxEventsPerStep` bounds per-step work separately from `maxEvents`, which continues to bound retained checkpoint history.

## [0.1.0] - 2026-08-25

### Added

- Ten parameterized xnews capability tools with discriminated operation schemas and no approval middleware.
- Provider-agnostic `createXnewsAnalyst` built on the current LangChain `createAgent` API.
- Finite checkpoint-resumable news, data, event, and realtime-ASR nodes.
- Bounded deterministic model digests, host-only artifacts, binary caps, hashing, truncation records, and operator PII/secret redaction.
- Public Zod 3.25.76 and Zod 4.2.0 compatible schemas, stable TypeScript types, and exhaustive capability registries.
- Exact-floor packaged-install smoke coverage for both supported Zod majors.

[Unreleased]: https://github.com/xbbg-org/xnews/compare/xnews-langgraph-v0.1.0...HEAD
[0.1.0]: https://github.com/xbbg-org/xnews/releases/tag/xnews-langgraph-v0.1.0
