/**
 * Projects a tool input schema into the one JSON Schema shape every major model
 * provider accepts, and reconciles model input back onto the source schema.
 *
 * Providers disagree about the root of a tool schema. OpenAI rejects any root that is
 * not `type: "object"`; Anthropic rejects `anyOf` at the root of a tool input schema;
 * Gemini rejects the combined state count that union-rooted schemas produce once a
 * full tool set is bound. A discriminated `operation` union therefore cannot be sent
 * as a union, so it is flattened into one closed object and per-operation
 * applicability moves into property descriptions. Zod-to-JSON-Schema conversion also
 * emits internal pointers such as `#/anyOf/0/properties/minSeverity`, which flattening
 * would dangle, so references are inlined first.
 *
 * Flattening advertises every operation's properties at one level, and models do fill
 * the superset they are shown. Such a call is not a model error against the schema it
 * received, so `reconcile` drops the properties that cannot apply to the chosen
 * operation instead of failing the call. Properties the union never declares survive
 * reconciliation and are still rejected: the source schema, not this projection,
 * remains the contract.
 *
 * Gemini compiles bound tool schemas into a decoding automaton, and LangChain's
 * structured-output strategy sends `tool_choice: "required"`, so the whole tool set is
 * compiled at once. Bounded repetition — `pattern`, `minLength`, `maxLength`,
 * `minItems`, `maxItems` — exhausts that budget and fails the request outright, while
 * enums, numeric ranges, and `format` fit. Those five size keywords are therefore not
 * advertised; the source schema still enforces every one of them.
 */
import { toJsonSchema, type JSONSchema } from "@langchain/core/utils/json_schema";

import { stableStringify } from "./digest.js";
import { isRecord } from "./type-guards.js";

// Keyword positions, never property names: `properties` children are names a schema may
// legitimately call `pattern` or `maxItems`.
const SIZE_CONSTRAINT_KEYWORDS: Readonly<Record<string, true>> = {
  pattern: true,
  minLength: true,
  maxLength: true,
  minItems: true,
  maxItems: true,
};
const NAMED_SCHEMA_MAPS: Readonly<Record<string, true>> = {
  properties: true,
  patternProperties: true,
  $defs: true,
  definitions: true,
};

function withoutSizeConstraints(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutSizeConstraints);
  if (!isRecord(node)) return node;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key in SIZE_CONSTRAINT_KEYWORDS) continue;
    if (key in NAMED_SCHEMA_MAPS && isRecord(value)) {
      kept[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, withoutSizeConstraints(child)]),
      );
      continue;
    }
    kept[key] = withoutSizeConstraints(value);
  }
  return kept;
}

type SchemaRecord = Readonly<Record<string, unknown>>;

interface OperationUsage {
  readonly required: string[];
  readonly optional: string[];
}

interface FlattenedUnion {
  readonly schema: SchemaRecord;
  readonly keysByOperation: ReadonlyMap<string, ReadonlySet<string>>;
  readonly declaredKeys: ReadonlySet<string>;
}

export interface XnewsToolSchemaProjection {
  /** Provider-portable JSON Schema to advertise to the model. */
  readonly jsonSchema: JSONSchema;
  /** Removes properties that belong only to other operations of the same union. */
  readonly reconcile: (value: unknown) => unknown;
}

function resolveLocalReference(document: SchemaRecord, reference: string): unknown {
  if (reference === "#") return document;
  if (!reference.startsWith("#/")) {
    throw new Error(`Tool schema reference '${reference}' is not a local JSON pointer`);
  }
  let node: unknown = document;
  for (const segment of reference.slice(2).split("/")) {
    const key = decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(node)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) {
        throw new Error(`Tool schema reference '${reference}' does not resolve`);
      }
      node = node[index];
      continue;
    }
    if (!isRecord(node) || !(key in node)) {
      throw new Error(`Tool schema reference '${reference}' does not resolve`);
    }
    node = node[key];
  }
  return node;
}

/** Inlines local references so a rewritten root cannot dangle a pointer. */
function inlineReferences(
  node: unknown,
  document: SchemaRecord,
  active: ReadonlySet<string>,
): unknown {
  if (Array.isArray(node)) return node.map((entry) => inlineReferences(entry, document, active));
  if (!isRecord(node)) return node;

  const inlined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref") continue;
    inlined[key] = inlineReferences(value, document, active);
  }

  const reference = node["$ref"];
  if (typeof reference !== "string") return inlined;
  if (active.has(reference)) {
    throw new Error(`Tool schema reference '${reference}' is recursive and cannot be projected`);
  }
  const resolved = inlineReferences(
    resolveLocalReference(document, reference),
    document,
    new Set([...active, reference]),
  );
  if (!isRecord(resolved)) {
    throw new Error(`Tool schema reference '${reference}' does not resolve to a schema object`);
  }
  return { ...resolved, ...inlined };
}

function variantOperation(variant: SchemaRecord): string {
  const properties = variant["properties"];
  const operation = isRecord(properties) ? properties["operation"] : undefined;
  if (isRecord(operation)) {
    const literal = operation["const"];
    if (typeof literal === "string") return literal;
    const values = operation["enum"];
    if (Array.isArray(values) && values.length === 1 && typeof values[0] === "string") {
      return values[0];
    }
  }
  throw new Error("Tool schema union variants must discriminate on a literal 'operation'");
}

/** Accepts every variant's shape for one property name, since the root cannot branch. */
function mergeProperty(
  properties: Map<string, unknown>,
  name: string,
  variantProperty: unknown,
): void {
  const existing = properties.get(name);
  if (existing === undefined) {
    properties.set(name, variantProperty);
    return;
  }
  const branches =
    isRecord(existing) && Array.isArray(existing["anyOf"]) ? existing["anyOf"] : [existing];
  const incoming = stableStringify(variantProperty);
  if (branches.some((branch) => stableStringify(branch) === incoming)) return;
  properties.set(name, { anyOf: [...branches, variantProperty] });
}

/** Restates the applicability a flattened root can no longer express structurally. */
function usageNote(usage: OperationUsage, variantCount: number): string | undefined {
  if (usage.required.length === variantCount) return undefined;
  const sentences: string[] = [];
  for (const [label, operations] of [
    ["Required", usage.required],
    ["Optional", usage.optional],
  ] as const) {
    if (operations.length === 0) continue;
    const quoted = operations.map((operation) => `'${operation}'`).join(", ");
    sentences.push(
      `${label} for ${operations.length === 1 ? "operation" : "operations"} ${quoted}.`,
    );
  }
  return sentences.length === 0 ? undefined : sentences.join(" ");
}

function flattenOperationUnion(
  document: SchemaRecord,
  variants: readonly unknown[],
): FlattenedUnion {
  if (variants.length === 0) throw new Error("Tool schema unions must have at least one variant");

  const properties = new Map<string, unknown>();
  const usageByProperty = new Map<string, OperationUsage>();
  const keysByOperation = new Map<string, Set<string>>();
  let sharedRequired: readonly string[] | undefined;
  let closed = true;

  for (const variant of variants) {
    if (!isRecord(variant)) throw new Error("Tool schema union variants must be schema objects");
    const operation = variantOperation(variant);
    const operationKeys = new Set<string>();
    keysByOperation.set(operation, operationKeys);

    const variantProperties = variant["properties"];
    if (!isRecord(variantProperties)) {
      throw new Error(`Tool schema variant '${operation}' has no properties`);
    }
    const required = Array.isArray(variant["required"])
      ? variant["required"].filter((name): name is string => typeof name === "string")
      : [];

    for (const [name, propertySchema] of Object.entries(variantProperties)) {
      if (name === "operation") continue;
      operationKeys.add(name);
      mergeProperty(properties, name, propertySchema);
      const usage = usageByProperty.get(name) ?? { required: [], optional: [] };
      (required.includes(name) ? usage.required : usage.optional).push(operation);
      usageByProperty.set(name, usage);
    }

    const requiredBesidesOperation = required.filter((name) => name !== "operation");
    sharedRequired =
      sharedRequired === undefined
        ? requiredBesidesOperation
        : sharedRequired.filter((name) => requiredBesidesOperation.includes(name));
    if (variant["additionalProperties"] !== false) closed = false;
  }

  const describedProperties: Record<string, unknown> = {
    operation: {
      type: "string",
      enum: [...keysByOperation.keys()],
      description: "Selects the operation. Which other properties apply depends on this value.",
    },
  };
  for (const [name, propertySchema] of properties) {
    const usage = usageByProperty.get(name) ?? { required: [], optional: [] };
    const note = usageNote(usage, variants.length);
    if (note === undefined || !isRecord(propertySchema)) {
      describedProperties[name] = propertySchema;
      continue;
    }
    const existing = propertySchema["description"];
    describedProperties[name] = {
      ...propertySchema,
      description:
        typeof existing === "string" && existing.length > 0 ? `${existing} ${note}` : note,
    };
  }

  const flattened: Record<string, unknown> = {
    type: "object",
    properties: describedProperties,
    required: ["operation", ...(sharedRequired ?? [])],
  };
  if (closed) flattened["additionalProperties"] = false;
  const description = document["description"];
  if (typeof description === "string") flattened["description"] = description;
  const dialect = document["$schema"];
  if (typeof dialect === "string") flattened["$schema"] = dialect;
  return { schema: flattened, keysByOperation, declaredKeys: new Set(properties.keys()) };
}

/**
 * Converts a tool input schema into a reference-free object schema that OpenAI,
 * Anthropic, and Gemini all accept, plus the reconciliation that maps a call written
 * against that flattened shape back onto the source schema.
 */
export function projectToolSchema(
  schema: Parameters<typeof toJsonSchema>[0] | SchemaRecord,
): XnewsToolSchemaProjection {
  // `toJsonSchema` declares a structural JSON Schema union too narrow to describe every
  // valid document it happily passes through, such as a single-variant `anyOf`.
  const converted: unknown = toJsonSchema(schema as Parameters<typeof toJsonSchema>[0]);
  if (!isRecord(converted)) throw new Error("Tool input schemas must convert to a schema object");
  const resolved = inlineReferences(converted, converted, new Set());
  if (!isRecord(resolved)) throw new Error("Tool input schemas must convert to a schema object");

  const variants = resolved["anyOf"] ?? resolved["oneOf"];
  let flattened: FlattenedUnion | undefined;
  if (Array.isArray(variants)) {
    flattened = flattenOperationUnion(resolved, variants);
  } else if (resolved["type"] !== "object") {
    throw new Error("Tool input schemas must be objects or discriminated operation unions");
  }

  // Every reference is inlined, so a retained definition block is dead weight a
  // provider would still have to parse.
  const projected = Object.entries(flattened?.schema ?? resolved).filter(
    ([key]) => key !== "$defs" && key !== "definitions",
  );
  const advertised = withoutSizeConstraints(Object.fromEntries(projected));
  if (!isRecord(advertised)) throw new Error("Tool input schemas must convert to a schema object");

  return {
    jsonSchema: advertised,
    reconcile(value: unknown): unknown {
      if (flattened === undefined || !isRecord(value)) return value;
      const operation = value["operation"];
      if (typeof operation !== "string") return value;
      const applicable = flattened.keysByOperation.get(operation);
      // An unknown operation is the source schema's error to report, not ours to hide.
      if (applicable === undefined) return value;
      const kept = Object.entries(value).filter(
        ([key]) => key === "operation" || applicable.has(key) || !flattened.declaredKeys.has(key),
      );
      return kept.length === Object.keys(value).length ? value : Object.fromEntries(kept);
    },
  };
}
