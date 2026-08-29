import { expect, test } from "bun:test";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { z } from "zod/v3";

import {
  XNEWS_CAPABILITY_REGISTRY,
  XNEWS_MODEL_INPUT_SCHEMAS,
  XNEWS_OPERATION_REGISTRY,
  XNEWS_TOOL_NAMES,
  createXnewsToolOutput,
  XnewsFilesInputSchema,
  XnewsNewsInputSchema,
  XnewsRuntimeContextSchema,
  XnewsWorksInputSchema,
  createXnewsTools,
  redactText,
  redactUrl,
  stableStringify,
  type XnewsByteArtifact,
} from "../src/index.js";
import { requireRuntimeContext, runtimeSecretValues } from "../src/context.js";
import type { XnewsAnalyst, XnewsRuntimeContext } from "../src/index.js";
import { isRecord } from "../src/type-guards.js";

const FORBIDDEN_MODEL_FIELDS = [
  "apiKey",
  "authorization",
  "credentials",
  "fetch",
  "mirror",
  "msrbAcceptTermsOfUse",
  "secUserAgent",
  "signal",
  "transport",
];

function schemaPropertyNames(value: unknown, names = new Set<string>()): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const entry of value) schemaPropertyNames(entry, names);
    return names;
  }
  if (!isRecord(value)) return names;

  const properties = value["properties"];
  if (isRecord(properties)) {
    for (const name of Object.keys(properties)) names.add(name);
  }
  for (const entry of Object.values(value)) schemaPropertyNames(entry, names);
  return names;
}

const invokeWithRuntimeContext = (analyst: XnewsAnalyst, context: XnewsRuntimeContext) =>
  analyst.invoke({ messages: [] }, { context });
const CustomContextSchema = XnewsRuntimeContextSchema.extend({ tenantLabel: z.string() });
const invokeWithCustomContext = (
  analyst: XnewsAnalyst<typeof CustomContextSchema>,
  context: z.input<typeof CustomContextSchema>,
) => analyst.invoke({ messages: [] }, { context });

test("exports ten exhaustive parameterized seams with operation registries", () => {
  const tools = createXnewsTools();
  expect(tools).toHaveLength(10);
  expect(tools.map((tool) => tool.name)).toEqual([...XNEWS_TOOL_NAMES]);
  expect(XNEWS_CAPABILITY_REGISTRY.map((entry) => entry.tool)).toEqual([...XNEWS_TOOL_NAMES]);
  for (const entry of XNEWS_CAPABILITY_REGISTRY) {
    expect(entry.operations.length).toBeGreaterThan(0);
    expect(XNEWS_OPERATION_REGISTRY[entry.tool]).toEqual(entry.operations);
  }
});

test("model-visible schemas exclude runtime credentials, consent, mirrors, and transport", () => {
  for (const [toolName, schema] of Object.entries(XNEWS_MODEL_INPUT_SCHEMAS)) {
    const propertyNames = schemaPropertyNames(toJsonSchema(schema));
    for (const field of FORBIDDEN_MODEL_FIELDS) {
      expect(propertyNames.has(field), `${toolName} exposes ${field}`).toBeFalse();
    }
  }
});

test("runtime and model schemas enforce closed, bounded authority inputs", () => {
  expect(XnewsRuntimeContextSchema.safeParse({ unknownRuntimeAuthority: "no" }).success).toBe(
    false,
  );
  expect(XnewsRuntimeContextSchema.safeParse({ dataSources: { broken: {} } }).success).toBe(false);
  expect(
    XnewsNewsInputSchema.safeParse({
      operation: "watchlist",
      subjects: Array.from({ length: 21 }, (_, index) => ({
        kind: "topic",
        query: `topic-${index}`,
      })),
    }).success,
  ).toBe(false);
  expect(XnewsWorksInputSchema.safeParse({ operation: "search", source: "works" }).success).toBe(
    false,
  );
  expect(
    XnewsFilesInputSchema.safeParse({
      operation: "download_file",
      file: "https://attacker.example/private",
    }).success,
  ).toBe(false);
  expect(
    XnewsFilesInputSchema.safeParse({ operation: "download_work", record: "host-record" }).success,
  ).toBe(false);
});

test("runtime context rejects malformed host-bound work records and files", () => {
  const record = {
    provider: "fixture",
    sourceId: "record-1",
    title: "Valid record",
    authors: ["Author"],
    identity: { origin: "record", confidence: 1, doi: "10.1000/valid" },
    availability: "open-access",
    url: "https://catalog.example/record-1",
    warnings: [],
    provenance: [{ provider: "fixture", url: "https://catalog.example/record-1" }],
  } as const;
  const file = {
    url: "https://files.example/record-1.pdf",
    label: "PDF",
    provider: "fixture",
    fileName: "record-1.pdf",
    format: "pdf",
    sizeBytes: 42,
  } as const;
  expect(
    XnewsRuntimeContextSchema.safeParse({ workRecords: { valid: record } }).success,
  ).toBeTrue();
  expect(XnewsRuntimeContextSchema.safeParse({ workFiles: { valid: file } }).success).toBeTrue();

  const malformedRecords = [
    { ...record, identity: {} },
    { ...record, identity: { origin: "record", confidence: 2 } },
    { ...record, availability: "invented" },
    { ...record, authors: [1] },
    { ...record, warnings: [false] },
    { ...record, provenance: [{ provider: "fixture", url: 42 }] },
    { ...record, pageCount: Number.NaN },
  ];
  for (const malformed of malformedRecords) {
    expect(XnewsRuntimeContextSchema.safeParse({ workRecords: { malformed } }).success).toBeFalse();
  }
  for (const malformed of [
    { ...file, fileName: 42 },
    { ...file, format: false },
    { ...file, sizeBytes: Number.POSITIVE_INFINITY },
  ]) {
    expect(XnewsRuntimeContextSchema.safeParse({ workFiles: { malformed } }).success).toBeFalse();
  }
});

test("runtime context validation is generic and secret traversal is cycle-bounded", () => {
  let invalidError: unknown;
  try {
    requireRuntimeContext({ redirect: "operator-private-value" });
  } catch (error) {
    invalidError = error;
  }
  expect(invalidError).toBeInstanceOf(TypeError);
  expect(String(invalidError)).toBe("TypeError: Invalid xnews runtime context");
  expect(String(invalidError)).not.toContain("operator-private-value");

  const extraBody: Record<string, unknown> = {
    apiKey: "nested-private-value",
    imageHint: "nested-public-value",
  };
  extraBody["self"] = extraBody;
  const context = requireRuntimeContext({
    credentials: { privateValues: ["readonly-private-value"] as readonly string[] },
    mirrors: ["https://mirror.example"] as readonly string[],
    ocr: { baseUrl: "https://ocr.example", extraBody },
  });
  expect(runtimeSecretValues(context)).toContain("nested-private-value");
  expect(runtimeSecretValues(context)).toContain("readonly-private-value");
  // Settings that are not credentials must not become redaction patterns.
  expect(runtimeSecretValues(context)).not.toContain("nested-public-value");
  expect(typeof invokeWithRuntimeContext).toBe("function");
  expect(typeof invokeWithCustomContext).toBe("function");
});

test("digest and artifact caps are deterministic, explicit, and redact operator PII", () => {
  const context = {
    artifactByteCap: 4,
    secUserAgent: "Operator Jane jane.operator@example.com +1 (212) 555-0100",
    credentials: {
      openAlexApiKey: "operator-secret-token",
      byProvider: { sample: "secondary-secret" },
    },
  } as const;
  const data = {
    apiKey: "operator-secret-token",
    contact: "jane.operator@example.com +1 (212) 555-0100",
    largeBytes: new Uint8Array([1, 2, 3, 4, 5]),
    smallBytes: new Uint8Array([9, 8, 7, 6]),
    url: "https://example.test/data?api_key=operator-secret-token&view=public",
    rows: [
      { id: 2, value: "second" },
      { id: 1, value: "first" },
    ],
  };
  const first = createXnewsToolOutput({
    tool: "xnews_data",
    operation: "fetch",
    status: "ok",
    data,
    items: data.rows,
    warnings: ["Contact jane.operator@example.com or +1 (212) 555-0100"],
    sources: [data.url],
    counts: { rows: 2 },
    context,
    options: { digestCaps: { xnews_data: { maxItems: 1, maxCharacters: 2_000 } } },
  });
  const second = createXnewsToolOutput({
    tool: "xnews_data",
    operation: "fetch",
    status: "ok",
    data,
    items: data.rows,
    warnings: ["Contact jane.operator@example.com or +1 (212) 555-0100"],
    sources: [data.url],
    counts: { rows: 2 },
    context,
    options: { digestCaps: { xnews_data: { maxItems: 1, maxCharacters: 2_000 } } },
  });

  expect(first[0]).toBe(second[0]);
  expect(first[0].length).toBeLessThanOrEqual(2_000);
  expect(first[0]).not.toContain("operator-secret-token");
  expect(first[0]).not.toContain("jane.operator@example.com");
  expect(first[0]).not.toContain("212");
  expect(first[1].digest.omissions.items).toBe(1);
  expect(first[1].digest.truncated).toBe(true);
  expect(first[1].binary).toEqual({
    capBytes: 4,
    retainedBytes: 4,
    omittedBytes: 5,
    truncatedFields: 1,
  });

  const artifact = first[1].data;
  if (!isRecord(artifact)) throw new Error("Expected object artifact data");
  expect(artifact["[REDACTED]"]).toBe("[REDACTED]");
  expect(stableStringify(artifact)).not.toContain("operator-secret-token");
  expect(stableStringify(artifact)).not.toContain("jane.operator@example.com");
  expect(artifact["largeBytes"]).toMatchObject({
    kind: "bytes",
    sizeBytes: 5,
    truncated: true,
    omittedBytes: 5,
  } satisfies Partial<XnewsByteArtifact>);
  expect(artifact["smallBytes"]).toMatchObject({
    kind: "bytes",
    sizeBytes: 4,
    truncated: false,
    omittedBytes: 0,
  } satisfies Partial<XnewsByteArtifact>);
});

test("redaction covers operator values and leaves public content intact", () => {
  expect(redactText("sec-edgar|0001628280-25-031459|Apple Inc. 10-K")).toBe(
    "sec-edgar|0001628280-25-031459|Apple Inc. 10-K",
  );
  expect(redactText("gdelt-1234567890 ISBN 9780306406157")).toBe(
    "gdelt-1234567890 ISBN 9780306406157",
  );

  // Upstream records carry third-party contact details as public record data. Only the
  // operator's own values, which the host supplied through runtime context, are redacted.
  const operator = ["jane.operator@example.com", "+1 (212) 555-0100"];
  expect(redactText("Filer contact: ir@apple.com or +1 (408) 996-1010")).toBe(
    "Filer contact: ir@apple.com or +1 (408) 996-1010",
  );
  expect(redactText("Contact +1 (212) 555-0100 or jane.operator@example.com", operator)).toBe(
    "Contact [REDACTED] or [REDACTED]",
  );

  // A public article URL survives whole: its path is routing, not a secret.
  const article = redactUrl(
    "https://news.google.com/rss/articles/CBMifEFVX3lxTFBZMDY3TVNCdDRkUVJT?oc=5&hl=en-US",
  );
  expect(article).toBe(
    "https://news.google.com/rss/articles/CBMifEFVX3lxTFBZMDY3TVNCdDRkUVJT?oc=5&hl=en-US",
  );

  // A capability URL carries its secret in a credential-named parameter.
  const capability = redactUrl(
    "https://files.example.test/download/AbCdEf0123456789AbCdEf0123456789?sig=capability&view=public",
  );
  expect(capability).toContain("AbCdEf0123456789AbCdEf0123456789");
  expect(capability).toContain("view=public");
  expect(capability).not.toContain("capability");
  expect(capability).toContain(encodeURIComponent("[REDACTED]"));

  // A host-supplied URL is an operator value, so it is redacted wherever it appears.
  const hostBound = redactUrl("https://mirror.internal.test/AbCdEf0123456789/file.pdf", [
    "https://mirror.internal.test/AbCdEf0123456789",
  ]);
  expect(hostBound).not.toContain("AbCdEf0123456789");

  const embedded = redactText(
    "failed https://files.example.test/item?key=secret-value and Bearer abc.def",
  );
  expect(embedded).not.toContain("secret-value");
  expect(embedded).not.toContain("abc.def");
});

// An OCR runtime config is mostly ordinary settings. Treating every nested string as a
// secret made short values such as `imageMode: "base"` rewrite public text.
test("only credential values from the OCR config become redaction patterns", () => {
  const secrets = runtimeSecretValues({
    ocr: {
      baseUrl: "https://ocr.internal.test",
      apiKey: "ocr-secret-value",
      model: "Unlimited-OCR",
      imageMode: "base",
      prompt: "describe",
      extraBody: { access_token: "extra-secret-value", mode: "fast" },
    },
  });

  expect(secrets).toContain("ocr-secret-value");
  expect(secrets).toContain("https://ocr.internal.test");
  expect(secrets).toContain("extra-secret-value");
  expect(secrets).not.toContain("base");
  expect(secrets).not.toContain("Unlimited-OCR");
  expect(secrets).not.toContain("describe");
  expect(secrets).not.toContain("fast");

  expect(redactText("database rows and base rates", secrets)).toBe("database rows and base rates");
  expect(redactText("sent ocr-secret-value upstream", secrets)).toBe("sent [REDACTED] upstream");
});
