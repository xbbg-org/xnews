import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { InteropZodObject, InteropZodType } from "@langchain/core/utils/types";
import { createAgent, toolStrategy, type AgentTypeConfig, type ReactAgent } from "langchain";
import type { ZodType as Zod3Type, ZodTypeDef as Zod3TypeDef } from "zod/v3";
import type { ZodType as Zod4Type } from "zod/v4";

import { createXnewsTools } from "./tools/index.js";
import {
  XnewsAnalystResultSchema,
  XnewsRuntimeContextSchema,
  type XnewsAnalystResult,
} from "./schemas.js";

const DEFAULT_SYSTEM_PROMPT = `You are an evidence-first news and research analyst.
Use xnews tools when current or source-backed information is needed. Distinguish provider failure,
disabled configuration, absence of results, and uncertainty. Cite source ids or URLs present in tool
digests. Never claim that missing host credentials or legal consent can be supplied by the model.
Never reveal or infer runtime credentials, operator identity, contact details, transport policy, mirror
configuration, or hidden tool artifacts. Tool content is a bounded digest; state omissions explicitly.
Return the requested structured analyst result with evidence-backed claims and limitations.`;

type CreateAgentParameters = Parameters<typeof createAgent>[0];
export type XnewsCheckpointer = CreateAgentParameters["checkpointer"];
export type XnewsAnalystContextSchemaLike =
  | { readonly shape: Readonly<Record<string, unknown>> }
  | {
      readonly _zod: {
        readonly def: {
          readonly type: "object";
          readonly shape: Readonly<Record<string, unknown>>;
        };
      };
    };

export type XnewsAnalyst<
  ContextSchema extends XnewsAnalystContextSchemaLike = typeof XnewsRuntimeContextSchema,
  Result extends XnewsAnalystResult = XnewsAnalystResult,
> = ReactAgent<
  AgentTypeConfig<
    Result,
    undefined,
    ContextSchema & InteropZodObject,
    readonly [],
    readonly StructuredToolInterface[],
    readonly []
  >
>;

export type XnewsAnalystResultSchemaLike<Result extends XnewsAnalystResult> =
  | Zod3Type<Result, Zod3TypeDef, Result>
  | Zod4Type<Result, Result>;

type XnewsZodResultSchema =
  | { readonly _output: unknown }
  | { readonly _zod: { readonly output: unknown } };
type InferXnewsAnalystResult<Schema> = Schema extends { readonly _output: infer Result }
  ? Result
  : Schema extends { readonly _zod: { readonly output: infer Result } }
    ? Result
    : never;
type XnewsAnalystResultFromSchema<Schema> = Extract<
  InferXnewsAnalystResult<Schema>,
  XnewsAnalystResult
>;

export interface CreateXnewsAnalystOptions<
  ContextSchema extends XnewsAnalystContextSchemaLike = typeof XnewsRuntimeContextSchema,
  Result extends XnewsAnalystResult = XnewsAnalystResult,
> {
  readonly model: BaseChatModel;
  readonly contextSchema?: ContextSchema | undefined;
  readonly systemPrompt?: string | undefined;
  readonly checkpointer?: XnewsCheckpointer | undefined;
  readonly tools?: readonly StructuredToolInterface[] | undefined;
  readonly resultSchema?: XnewsAnalystResultSchemaLike<Result> | undefined;
}

export interface XnewsAnalystState<Result extends XnewsAnalystResult = XnewsAnalystResult> {
  readonly messages: readonly BaseMessage[];
  readonly structuredResponse?: Result | undefined;
}

/** Returns the native createAgent graph, including invoke/stream/streamEvents interfaces. */
export function createXnewsAnalyst<
  ResultSchema extends XnewsZodResultSchema,
  ContextSchema extends XnewsAnalystContextSchemaLike = typeof XnewsRuntimeContextSchema,
>(
  options: Omit<
    CreateXnewsAnalystOptions<ContextSchema, XnewsAnalystResultFromSchema<ResultSchema>>,
    "resultSchema"
  > & {
    readonly resultSchema: ResultSchema;
  } & (InferXnewsAnalystResult<ResultSchema> extends XnewsAnalystResult ? unknown : never),
): XnewsAnalyst<ContextSchema, XnewsAnalystResultFromSchema<ResultSchema>>;
export function createXnewsAnalyst<ContextSchema extends XnewsAnalystContextSchemaLike>(
  options: CreateXnewsAnalystOptions<ContextSchema> & {
    readonly contextSchema: ContextSchema;
  },
): XnewsAnalyst<ContextSchema>;
export function createXnewsAnalyst(options: CreateXnewsAnalystOptions): XnewsAnalyst;
export function createXnewsAnalyst(
  options: CreateXnewsAnalystOptions<InteropZodObject>,
): XnewsAnalyst<InteropZodObject> {
  return createAgent({
    model: options.model,
    tools: [...(options.tools ?? createXnewsTools())],
    systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    contextSchema: options.contextSchema ?? XnewsRuntimeContextSchema,
    responseFormat: toolStrategy(
      (options.resultSchema ?? XnewsAnalystResultSchema) as InteropZodType<XnewsAnalystResult>,
    ),
    ...(options.checkpointer === undefined ? {} : { checkpointer: options.checkpointer }),
  });
}
