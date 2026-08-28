import { expect, test } from "bun:test";

import {
  XNEWS_OPERATION_REGISTRY,
  XNEWS_TOOL_NAMES,
  XnewsEventsInputSchema,
  XnewsNewsInputSchema,
  XnewsResearchInputSchema,
  createXnewsTools,
  projectToolSchema,
} from "../src/index.js";
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
const SIZE_CONSTRAINT_KEYWORDS = ["pattern", "minLength", "maxLength", "minItems", "maxItems"];
const NAMED_SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

/** Collects keys in keyword position only, so a property named `pattern` is not one. */
function keywordPositions(value: unknown, found = new Set<string>()): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const entry of value) keywordPositions(entry, found);
    return found;
  }
  if (!isRecord(value)) return found;
  for (const [key, entry] of Object.entries(value)) {
    if (NAMED_SCHEMA_MAPS.has(key)) {
      if (isRecord(entry)) for (const child of Object.values(entry)) keywordPositions(child, found);
      continue;
    }
    found.add(key);
    keywordPositions(entry, found);
  }
  return found;
}

function schemaKeys(value: unknown, keys = new Set<string>()): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const entry of value) schemaKeys(entry, keys);
    return keys;
  }
  if (!isRecord(value)) return keys;
  for (const [key, entry] of Object.entries(value)) {
    keys.add(key);
    schemaKeys(entry, keys);
  }
  return keys;
}

function propertySchema(schema: unknown, name: string): Readonly<Record<string, unknown>> {
  const properties = isRecord(schema) ? schema["properties"] : undefined;
  const property = isRecord(properties) ? properties[name] : undefined;
  if (!isRecord(property)) throw new Error(`schema has no '${name}' property`);
  return property;
}

// A union at the root is unusable: OpenAI requires `type: "object"`, Anthropic rejects
// a typed root that also carries `anyOf`, and Gemini rejects the state count of ten
// union-rooted schemas bound together.
test("every model-facing tool schema is a reference-free object rooted on an operation", () => {
  const schemaByName = new Map<string, unknown>(
    createXnewsTools().map((tool) => [tool.name, tool.schema]),
  );
  for (const name of XNEWS_TOOL_NAMES) {
    const schema = schemaByName.get(name);
    expect(isRecord(schema)).toBeTrue();
    if (!isRecord(schema)) continue;

    expect(schema["type"], `${name} root type`).toBe("object");
    expect(schema["anyOf"], `${name} root anyOf`).toBeUndefined();
    expect(schema["oneOf"], `${name} root oneOf`).toBeUndefined();
    expect(schema["additionalProperties"], `${name} is closed`).toBe(false);

    const keys = schemaKeys(schema);
    expect(keys.has("$ref"), `${name} keeps a dangling reference`).toBeFalse();
    expect(keys.has("$defs"), `${name} keeps dead definitions`).toBeFalse();
    expect(keys.has("definitions"), `${name} keeps dead definitions`).toBeFalse();
    for (const field of FORBIDDEN_MODEL_FIELDS) {
      expect(keys.has(field), `${name} exposes ${field}`).toBeFalse();
    }
    for (const keyword of SIZE_CONSTRAINT_KEYWORDS) {
      expect(keywordPositions(schema).has(keyword), `${name} advertises ${keyword}`).toBeFalse();
    }

    const operation = propertySchema(schema, "operation");
    const declared = XNEWS_OPERATION_REGISTRY[name];
    const offered = Array.isArray(operation["enum"])
      ? operation["enum"]
      : [operation["const"]].filter((value) => value !== undefined);
    expect(offered, `${name} operations`).toEqual([...declared]);
  }
});

// Dropping size constraints must not cost the guidance that still fits the budget.
test("numeric bounds, enums, and formats survive the projection", () => {
  const news: unknown = createXnewsTools().find((tool) => tool.name === "xnews_news")?.schema;
  expect(isRecord(news)).toBeTrue();
  if (!isRecord(news)) return;
  expect(propertySchema(news, "limit")["maximum"]).toBeNumber();
  expect(propertySchema(news, "sources")["type"]).toBe("array");
  expect(Array.isArray(propertySchema(news, "operation")["enum"])).toBeTrue();
});

test("size keywords are stripped by position, not by name", () => {
  const named = projectToolSchema({
    type: "object",
    properties: {
      pattern: { type: "string", maxLength: 8 },
      maxItems: { type: "number", maximum: 4 },
    },
    required: ["pattern"],
    additionalProperties: false,
  });
  const projected: unknown = named.jsonSchema;
  const properties = isRecord(projected) ? projected["properties"] : undefined;
  expect(isRecord(properties)).toBeTrue();
  if (!isRecord(properties)) return;
  // The properties themselves are user data and must survive.
  expect(Object.keys(properties)).toEqual(["pattern", "maxItems"]);
  expect(propertySchema(projected, "pattern")["maxLength"]).toBeUndefined();
  expect(propertySchema(projected, "maxItems")["maximum"]).toBe(4);
});

test("flattening moves per-operation requirements into descriptions", () => {
  const events: unknown = createXnewsTools().find((tool) => tool.name === "xnews_events")?.schema;
  expect(isRecord(events)).toBeTrue();
  if (!isRecord(events)) return;

  // Only the discriminator survives as structurally required; `source` and `sources`
  // belong to different operations, so requiring either would reject the other.
  expect(events["required"]).toEqual(["operation"]);
  expect(propertySchema(events, "source")["description"]).toContain(
    "Required for operation 'snapshot'",
  );
  expect(propertySchema(events, "sources")["description"]).toContain(
    "Required for operation 'across'",
  );
  // Shared by both operations and required by neither.
  expect(propertySchema(events, "countryCodes")["description"]).toContain(
    "Optional for operations 'snapshot', 'across'",
  );
  // `minSeverity` is emitted as a pointer into the union that flattening would dangle.
  expect(propertySchema(events, "minSeverity")["enum"]).toEqual([
    "extreme",
    "severe",
    "moderate",
    "minor",
    "unknown",
  ]);
});

test("the source schema, not the projection, still rejects cross-operation input", () => {
  expect(XnewsEventsInputSchema.safeParse({ operation: "snapshot", source: "nws" }).success).toBe(
    true,
  );
  expect(XnewsEventsInputSchema.safeParse({ operation: "snapshot" }).success).toBe(false);
  expect(
    XnewsEventsInputSchema.safeParse({ operation: "snapshot", sources: ["nws"] }).success,
  ).toBe(false);
});

test("a projection that would lose meaning fails closed", () => {
  const recursive = {
    anyOf: [
      {
        type: "object",
        properties: { operation: { const: "loop" }, self: { $ref: "#/anyOf/0" } },
        required: ["operation"],
        additionalProperties: false,
      },
    ],
  };
  expect(() => projectToolSchema(recursive)).toThrow(/recursive/u);

  const undiscriminated = {
    anyOf: [
      { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
      { type: "object", properties: { b: { type: "string" } }, additionalProperties: false },
    ],
  };
  expect(() => projectToolSchema(undiscriminated)).toThrow(/discriminate/u);

  expect(() => projectToolSchema({ type: "string" })).toThrow(/must be objects/u);
});

// A flattened root advertises every operation's properties at once, and models fill
// what they are shown; those properties cannot apply, so they are dropped rather than
// bounced back as an error the model cannot act on.
test("reconciliation drops other operations' properties and keeps genuine mistakes", () => {
  const news = projectToolSchema(XnewsNewsInputSchema);
  const overfilled = {
    operation: "topic",
    query: "semiconductor export controls",
    limit: 5,
    ticker: "NVDA",
    companyName: "NVIDIA",
    cik: "0001045810",
    secForms: ["8-K"],
    subjects: [{ kind: "topic", query: "semiconductor export controls" }],
  };
  expect(XnewsNewsInputSchema.safeParse(overfilled).success).toBe(false);
  expect(news.reconcile(overfilled)).toEqual({
    operation: "topic",
    query: "semiconductor export controls",
    limit: 5,
  });
  expect(XnewsNewsInputSchema.safeParse(news.reconcile(overfilled)).success).toBe(true);

  // A property no operation declares is a real error and must survive to the parser.
  expect(news.reconcile({ operation: "topic", query: "rates", bogus: 1 })).toEqual({
    operation: "topic",
    query: "rates",
    bogus: 1,
  });
  // An unknown operation belongs to the source schema's enum error, not to us.
  const unknownOperation = { operation: "nope", ticker: "NVDA" };
  expect(news.reconcile(unknownOperation)).toBe(unknownOperation);
  // A single-object schema has nothing to reconcile.
  const research = { operation: "search", query: "rates" };
  expect(projectToolSchema(XnewsResearchInputSchema).reconcile(research)).toBe(research);
});

test("a tool accepts a call written against the flattened schema", async () => {
  const catalog = createXnewsTools().find((tool) => tool.name === "xnews_catalog");
  expect(catalog).toBeDefined();
  if (catalog === undefined) return;

  const message = await catalog.invoke(
    {
      type: "tool_call",
      id: "catalog-overfilled",
      name: "xnews_catalog",
      // `source` belongs to the request_* operations only.
      args: { operation: "providers", seam: "news", source: "cot" },
    },
    { context: {} },
  );
  const content = typeof message.content === "string" ? message.content : "";
  expect(content).toContain("providers");
  expect(content).not.toContain("Unrecognized key");
});
