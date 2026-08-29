# @xbbg/xnews-langgraph

Provider-agnostic LangChain tools, finite LangGraph nodes, and a starter analyst for [`@xbbg/xnews`](https://github.com/xbbg-org/xnews).

## Requirements

- Node.js 24 or newer
- `@xbbg/xnews ^0.2.2`
- `@langchain/core ^1.2.9`
- `@langchain/langgraph ^1.4.12`
- `langchain ^1.5.10`
- `zod ^3.25.76 || ^4.2.0`

The package does not install or select a model provider.

```sh
npm install @xbbg/xnews-langgraph @xbbg/xnews @langchain/core @langchain/langgraph langchain zod
```

## Tools

`createXnewsTools()` always returns all ten parameterized capability seams. There is no approval middleware, privileged tier, or hidden exclusion:

```ts
import { createXnewsTools } from "@xbbg/xnews-langgraph";

const tools = createXnewsTools();
console.log(tools.map((tool) => tool.name));
```

The seams are `xnews_news`, `xnews_research`, `xnews_data`, `xnews_events`, `xnews_works`, `xnews_files`, `xnews_extract`, `xnews_ocr`, `xnews_transcribe`, and `xnews_catalog`. Each uses an operation discriminator. Data, event, works, binary, OCR, and ASR resources are selected by opaque keys bound by the host in runtime context; provider-specific credentials and transport settings are never model arguments.

`xnews_files` accepts only host-bound `workRecords` and `workFiles` keys. It never accepts a model-supplied work record or download URL, so host credentials cannot be attached to a model-selected origin and model calls cannot become an arbitrary network fetch.
`resolve` returns provider candidates for host review; it does not authorize a download. The host
must validate a candidate's origin and bind the approved `WorkFile` under `workFiles` before the
model can call `download_file`. There is no operation that resolves and follows a provider-selected
URL in one step. YouTube caption discovery likewise follows only HTTPS caption URLs on
YouTube/Google-owned caption origins.

Model-facing schemas are projected, not raw. Each seam's discriminated `operation` union is
flattened into one closed object whose property descriptions state which operations require or
accept each field, internal JSON Schema references are inlined, and bounded-repetition keywords
(`pattern`, `minLength`, `maxLength`, `minItems`, `maxItems`) are omitted. That is the only shape
every major provider accepts: OpenAI rejects a root that is not `type: "object"`, Anthropic
rejects `anyOf` at the root of a tool schema, and Gemini rejects the decoding-state count that
union-rooted or repetition-bounded schemas produce across a bound tool set.

The Zod schemas stay the contract. Omitted bounds are still enforced when the tool runs, and a
call that violates one returns an actionable error the agent can retry. Properties that belong to
a different operation of the same union are dropped instead of rejected, since the flattened
schema advertised them; properties no operation declares are still rejected. `projectToolSchema`
is exported for hosts that bind their own tools, returning both the portable `jsonSchema` and the
matching `reconcile`.

```ts
import { cotDataSource } from "@xbbg/xnews";
import { createXnewsTools, type XnewsRuntimeContext } from "@xbbg/xnews-langgraph";

const context: XnewsRuntimeContext = {
  fetch: globalThis.fetch,
  signal: AbortSignal.timeout(30_000),
  timeoutMs: 20_000,
  maxResponseBytes: 16 * 1024 * 1024,
  secUserAgent: process.env.SEC_USER_AGENT,
  msrbAcceptTermsOfUse: process.env.EMMA_TERMS_ACCEPTED === "true",
  credentials: {
    openAlexApiKey: process.env.OPENALEX_API_KEY,
    privateValues: [process.env.OPERATOR_NAME].filter((value): value is string => Boolean(value)),
  },
  dataSources: { cot: cotDataSource("legacy") },
  artifactByteCap: 8 * 1024 * 1024,
};

const dataTool = createXnewsTools().find((tool) => tool.name === "xnews_data")!;
const message = await dataTool.invoke(
  {
    type: "tool_call",
    id: "call-1",
    name: "xnews_data",
    args: { operation: "fetch", source: "cot", limit: 25 },
  },
  { context },
);
```

## Tool results and privacy

Every tool result is a `ToolMessage` with two deliberately different payloads:

- `content` is a deterministic bounded digest sent to the model. It includes status, counts, selected records, warnings, source references, and explicit omission counts.
- `artifact` is host-only structured data. Normalized xnews envelopes remain complete except that operator secrets are redacted, and binary fields obey the total artifact byte cap. Over-cap bytes are replaced by their observed size, SHA-256 hash, omitted-byte count, and truncation flag.

Redaction targets the operator's own data, not the record. Every value the host supplied through runtime context — API keys, the SEC contact identity and any address or phone number inside it, mirror origins, OCR endpoints and keys, and anything in `credentials.privateValues` — is replaced by `[REDACTED]` wherever it appears, at any depth, along with credential-named fields (`authorization`, `cookie`, `token`, …), `Bearer` tokens, URL userinfo, and credential-named query parameters such as `api_key`, `token`, and `sig`. Add operator fragments that cannot be inferred reliably, such as a personal name, to `credentials.privateValues`.

Public content is left intact. A provider's article path, document slug, or locale query parameter is routing, not a secret, and a contact address printed in a filing is the record's data rather than yours; blanking them would make citations unusable without protecting the operator. Tool inputs and results are not logged by this package.

Upstream public news, filings, works, transcripts, and datasets can themselves contain personal data. `ToolMessage.artifact` lives in message state, may be persisted by a caller-supplied checkpointer, and is passed to LangChain callbacks/tracers as tool output. Disable external tracing for these tools or protect callback, trace, artifact, and checkpoint stores with appropriate access controls, retention limits, encryption, redaction, and deletion policies. This package does not configure LangSmith or another tracing backend.

## Analyst

Supply any tool-capable LangChain `BaseChatModel`. The native graph returned by `createAgent` is exposed directly, including `invoke`, `stream`, and `streamEvents`.

```ts
import { createXnewsAnalyst, type XnewsRuntimeContext } from "@xbbg/xnews-langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

declare const model: BaseChatModel; // Construct this in your chosen provider package.
declare const context: XnewsRuntimeContext;

const analyst = createXnewsAnalyst({ model });
const result = await analyst.invoke(
  { messages: [{ role: "user", content: "What changed in semiconductor supply risk?" }] },
  {
    configurable: { thread_id: "supply-risk" },
    context,
  },
);

console.log(result.messages);
console.log(result.structuredResponse);

for await (const update of await analyst.stream(
  { messages: [{ role: "user", content: "Refresh the analysis." }] },
  { configurable: { thread_id: "supply-risk" }, context, streamMode: "updates" },
)) {
  console.log(update);
}
```

By default the analyst binds all ten tools and parses `structuredResponse` with
`XnewsAnalystResultSchema`. The result tool advertises the projected schema, and the model's
arguments are parsed with the result schema itself rather than only JSON-Schema-validated, so its
transforms apply to `structuredResponse` and to the `ToolMessage` and closing `AIMessage` the
agent derives from it — the copies a checkpointer persists. `tools`, `systemPrompt`,
`contextSchema`, `resultSchema`, and `checkpointer` may be supplied explicitly. A custom context
schema should extend `XnewsRuntimeContextSchema`; extra fields remain available to custom tools
while the built-in tools parse only the allowlisted runtime fields. A custom result schema must
retain the `XnewsAnalystResult` contract and is responsible for equivalent PII and URL redaction.
The package chooses no persistence backend.

`generatedAt` is stamped by the runtime when the result is parsed; the model's value is
discarded. A model reports its training era rather than the clock, and dating an analysis
two years into the past silently corrupts anything that orders or expires results.

## Finite watcher nodes

Infinite async generators are not tools. These factories perform exactly one poll or drain step and return serializable checkpoint updates:

- `createXnewsNewsNode`: `seenIds` and `addedItems`
- `createXnewsDataWatchNode`: `sinceAsOf` / `sinceSequence`, release, and repeated-failure count
- `createXnewsEventWatchNode`: bounded `seenIds`, authoritative full `result.events`, and `addedEvents` delta
- `createXnewsRealtimeAsrNode`: base64 PCM queue, consumed chunk ids, and emitted events

Add the returned async function as a node in your own `StateGraph`, define the matching state channels with current `StateSchema` APIs, and compile with your chosen checkpointer. A checkpoint is committed after a successful node step; rerunning the committed state does not replay consumed ids, dates, sequences, or chunks.

Realtime ASR opens a new backend session for each non-empty invocation. Backend objects, sessions, streams, and sockets are invocation-local and never enter returned state. A process restart cannot resume a live ASR session: uncommitted queued chunks start a new session and replay, while checkpointed consumed chunks do not.
ASR collection has both retention and work bounds. `maxEvents` controls returned checkpoint
history, while `maxEventsPerStep` defaults to 4,000 and is hard-capped at 10,000. PCM tool and node
iterations use `context.timeoutMs` as an invocation deadline (30 seconds by default, capped at two
minutes), race providers that ignore abort signals, and do not commit queued chunks when a node
hits its event or time limit.

## Host responsibilities

The host, never the model, is responsible for:

- credentials and provider account configuration;
- the SEC contact/User-Agent identity;
- affirmative acceptance of MSRB EMMA terms;
- injected fetch, abort signals, timeouts, response ceilings, redirects, and user agent;
- mirror origins and authentication;
- OCR and transcription endpoints/backends;
- request volume, model/tool cost, artifact byte caps, and digest caps;
- checkpointer security, storage growth, access control, and retention.

The capability and operation registries are exported for inspection: `XNEWS_CAPABILITY_REGISTRY`, `XNEWS_OPERATION_REGISTRY`, `XNEWS_NEWS_PROVIDERS`, `XNEWS_RESEARCH_PROVIDERS`, `XNEWS_EVENT_PROVIDERS`, `XNEWS_WORKS_PROVIDERS`, and `XNEWS_DATASETS`.

## License

Apache-2.0
