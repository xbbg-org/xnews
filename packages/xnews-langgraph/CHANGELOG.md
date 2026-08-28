# Changelog

All notable changes to `@xbbg/xnews-langgraph` are documented in this file.

## [Unreleased]

### Changed

- The companion now shares the core's version line: `@xbbg/xnews-langgraph` and `@xbbg/xnews` are released at the same version, and the `@xbbg/xnews` peer range is the version they ship together (`^0.2.1`). Nothing else changed from `0.1.0`; the jump from `0.1.0` to `0.2.1` is the alignment itself, not new behavior.

## [0.1.0] - 2026-08-25

### Added

- Ten parameterized xnews capability tools with discriminated operation schemas and no approval middleware.
- Model-facing tool schemas are projected into the one JSON Schema shape OpenAI, Anthropic, and Gemini all accept, verified live against all three. A root-level union is not portable: OpenAI rejects any root that is not `type: "object"`, Anthropic rejects `anyOf` at the root of a tool schema, and Gemini rejects the combined decoding-state count of the bound tool set, so seven of the ten seams were unusable on OpenAI models and the analyst could not start on Gemini. `projectToolSchema` flattens each discriminated `operation` union into one closed object, restates in each property's description which operations require or accept it, inlines internal pointers such as `#/anyOf/0/properties/minSeverity` that flattening would dangle, and omits the five bounded-repetition keywords (`pattern`, `minLength`, `maxLength`, `minItems`, `maxItems`) that exhaust Gemini's budget; enums, numeric ranges, and formats are kept. The projection is model guidance only — the Zod schemas remain the runtime contract and still enforce every omitted bound — and its `reconcile` drops properties belonging to other operations of the same union, because a model filling the superset it was shown is not making an error the schema told it to avoid. Properties no operation declares survive and are still rejected.
- Resolution and download are separate acts. `resolve` returns provider candidates for host review, and the host must bind an approved `WorkFile` under `workFiles` before `download_file` will run. No operation resolves a work and follows a provider-selected URL in one step, so the model cannot reach an origin no host approved. YouTube caption discovery likewise follows only HTTPS caption URLs on YouTube- and Google-owned origins.
- Provider-agnostic `createXnewsAnalyst` built on the current LangChain `createAgent` API. It infers its structured result type from the supplied `resultSchema` across both supported Zod majors, so a caller-provided schema yields a typed `structuredResponse` rather than the default union; `XnewsAnalystContextSchemaLike` and `XnewsAnalystResultSchemaLike` are exported for callers that wrap the factory. The analyst advertises the projected result schema and parses the model's arguments with the result schema itself, because LangChain's `ToolStrategy.parse` only JSON-Schema-validates and returns those arguments unchanged: without this, the result schema's redaction never ran, and the agent copies that value into `structuredResponse`, a `ToolMessage`, and a closing `AIMessage` that a checkpointer persists. A rejected result still uses LangChain's built-in retry path.
- Finite checkpoint-resumable news, data, event, and realtime-ASR nodes. ASR collection is bounded in work and in time: `maxEventsPerStep` (4,000 by default, hard-capped at 10,000) bounds per-step events separately from the `maxEvents` retention bound, and `context.timeoutMs` acts as an invocation deadline (30 seconds by default, capped at two minutes) raced against providers that ignore abort signals. A step that overflows or times out throws without consuming its queued chunks, so a resumed checkpoint replays them; a stream ending exactly at the cap omitted nothing and is reported as complete.
- Bounded deterministic model digests, host-only artifacts, binary caps, hashing, truncation records, and operator PII/secret redaction. Node updates redact by key name as well as by known secret value, so a key such as `authorization`, `cookie`, `email`, or `phone` becomes `[REDACTED]` at every depth and a provider payload cannot carry operator PII or credentials into checkpointed state.
- Runtime context guards reject a malformed `WorkRecord` or `WorkFile` at the boundary: author and warning arrays must hold strings, provenance entries must carry a provider and URL, identity confidence must be a finite value in `[0, 1]`, and availability must be one of the known states.
- Public Zod 3.25.76 and Zod 4.2.0 compatible schemas, stable TypeScript types, and exhaustive capability registries.
- Exact-floor packaged-install smoke coverage for both supported Zod majors.

[Unreleased]: https://github.com/xbbg-org/xnews/compare/xnews-langgraph-v0.1.0...HEAD
[0.1.0]: https://github.com/xbbg-org/xnews/releases/tag/xnews-langgraph-v0.1.0
