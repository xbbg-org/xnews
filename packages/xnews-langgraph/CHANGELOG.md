# Changelog

All notable changes to `@xbbg/xnews-langgraph` are documented in this file.

## [Unreleased]

### Fixed

- Credential field names are matched by word instead of by substring. `secretary`, `tokenCount`, `cookieBanner`, and `credentialsPolicy` were treated as credentials and blanked in digests, artifacts, and node state; a name now qualifies only when its last word is a credential word, so `apiKey`, `access_token`, and `clientSecret` still match.
- `structuredResponse.generatedAt` is stamped by the runtime when the result is parsed instead of being taken from the model. Asked for a result over live 2026 articles, two of three providers dated it to 2024 and one flagged the current articles as "predictive or speculative" — a model reports its training era, not the clock.
- Every model call now carries the current UTC date and the rule that goes with it: judge tool dates against that date rather than against training data, and do not discount an item solely because it postdates what the model recalls, while still questioning a record that is malformed or internally inconsistent. Without a clock a model treats anything newer than its training as hypothetical: `gemini-2.5-flash` reported live articles as "predictive or speculative rather than current news" and listed their dates as a limitation of the analysis. Both disappear once the date is supplied. The date and rule are restated per model call and accompany a custom `systemPrompt` as well as the default one.

### Added

- Digest items carry a short `ref`, and `collectXnewsEvidence` / `resolveXnewsCitation` turn a citation back into the record the tools returned. A news item's own id is `provider|guid|title` and runs past 260 characters, so a model asked to cite it truncates at the `provider|guid` boundary: measured live across three providers, no cited id matched the id the model had been shown, and every one matched once the trailing title was stripped. Citations are now 24 characters and resolve exactly — 4/4 on every provider — and the index still accepts a full id or a truncated prefix so existing callers keep working. `ref` is a hash of the raw id, so a host can recompute it from the record it holds even when the digest truncated the id. A prefix claimed by two records — the same guid republished under a revised headline — resolves to neither rather than to whichever arrived first, and an unresolved citation is left exactly as the model wrote it.
- `ref` is a reserved field: a provider record carrying its own `ref` cannot choose the handle a citation resolves through, and one handle presented for two different ids resolves to neither. The handle is 96 bits rather than a shorter prefix, because provider content is attacker-influenced and grinding a 48-bit collision to make one item resolve as another is roughly 2^24 work.

## [0.2.2] - 2026-08-29

### Fixed

- Runtime-secret collection no longer turns ordinary OCR settings into redaction patterns. Every nested string under `context.ocr` was treated as a secret, so an `imageMode` of `"base"` rewrote the word "database" in public provider text and a `model` of `"Unlimited-OCR"` would blank the model name wherever it appeared. Only `ocr.apiKey`, `ocr.baseUrl`, and values under credential-named keys inside `ocr.extraBody` are collected now; `0.2.1` shipped with the wider collection.
- The `@xbbg/xnews` peer range tracks the shared version line and now names `^0.2.2`.

## [0.2.1] - 2026-08-28

### Changed

- The companion now shares the core's version line: `@xbbg/xnews-langgraph` and `@xbbg/xnews` are released at the same version, and the `@xbbg/xnews` peer range is the version they ship together (`^0.2.1`). The jump from `0.1.0` to `0.2.1` is that alignment, not a change in scope.

### Fixed

- Redaction no longer destroys public content. `redactUrl` blanked every query value and any path segment over 24 mixed characters, and `redactText` stripped every address and phone-like number, so a Google News article id, a Federal Register slug, a search term, and a filing's published contact all came back as `[REDACTED]` — citations the host could not follow. Redaction now targets the operator's own data: values the host supplied through runtime context (matched at any depth, including addresses and phone numbers inside `secUserAgent`), credential-named fields, `Bearer` tokens, URL userinfo, and credential-named query parameters such as `api_key`, `token`, `key`, and `sig`. The key-name list no longer covers `email`, `phone`, `contact`, `userAgent`, `mirror`, or `baseUrl`, which named upstream record fields as often as operator configuration.

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

[Unreleased]: https://github.com/xbbg-org/xnews/compare/xnews-langgraph-v0.2.2...HEAD
[0.2.2]: https://github.com/xbbg-org/xnews/compare/xnews-langgraph-v0.2.1...xnews-langgraph-v0.2.2
[0.2.1]: https://github.com/xbbg-org/xnews/compare/xnews-langgraph-v0.1.0...xnews-langgraph-v0.2.1
[0.1.0]: https://github.com/xbbg-org/xnews/releases/tag/xnews-langgraph-v0.1.0
