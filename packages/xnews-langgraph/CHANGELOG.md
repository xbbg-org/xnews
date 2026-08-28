# Changelog

All notable changes to `@xbbg/xnews-langgraph` are documented in this file.

## [Unreleased]

## [0.1.0] - 2026-08-25

### Added

- Ten parameterized xnews capability tools with discriminated operation schemas and no approval middleware.
- Resolution and download are separate acts. `resolve` returns provider candidates for host review, and the host must bind an approved `WorkFile` under `workFiles` before `download_file` will run. No operation resolves a work and follows a provider-selected URL in one step, so the model cannot reach an origin no host approved. YouTube caption discovery likewise follows only HTTPS caption URLs on YouTube- and Google-owned origins.
- Provider-agnostic `createXnewsAnalyst` built on the current LangChain `createAgent` API. It infers its structured result type from the supplied `resultSchema` across both supported Zod majors, so a caller-provided schema yields a typed `structuredResponse` rather than the default union; `XnewsAnalystContextSchemaLike` and `XnewsAnalystResultSchemaLike` are exported for callers that wrap the factory.
- Finite checkpoint-resumable news, data, event, and realtime-ASR nodes. ASR collection is bounded in work and in time: `maxEventsPerStep` (4,000 by default, hard-capped at 10,000) bounds per-step events separately from the `maxEvents` retention bound, and `context.timeoutMs` acts as an invocation deadline (30 seconds by default, capped at two minutes) raced against providers that ignore abort signals. A step that overflows or times out throws without consuming its queued chunks, so a resumed checkpoint replays them; a stream ending exactly at the cap omitted nothing and is reported as complete.
- Bounded deterministic model digests, host-only artifacts, binary caps, hashing, truncation records, and operator PII/secret redaction. Node updates redact by key name as well as by known secret value, so a key such as `authorization`, `cookie`, `email`, or `phone` becomes `[REDACTED]` at every depth and a provider payload cannot carry operator PII or credentials into checkpointed state.
- Runtime context guards reject a malformed `WorkRecord` or `WorkFile` at the boundary: author and warning arrays must hold strings, provenance entries must carry a provider and URL, identity confidence must be a finite value in `[0, 1]`, and availability must be one of the known states.
- Public Zod 3.25.76 and Zod 4.2.0 compatible schemas, stable TypeScript types, and exhaustive capability registries.
- Exact-floor packaged-install smoke coverage for both supported Zod majors.

[Unreleased]: https://github.com/xbbg-org/xnews/compare/xnews-langgraph-v0.1.0...HEAD
[0.1.0]: https://github.com/xbbg-org/xnews/releases/tag/xnews-langgraph-v0.1.0
