import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { InteropZodObject, InteropZodType } from "@langchain/core/utils/types";
import { createAgent, toolStrategy, type AgentTypeConfig, type ReactAgent } from "langchain";

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
export type XnewsAnalyst<
  ContextSchema extends InteropZodObject = typeof XnewsRuntimeContextSchema,
> = ReactAgent<
  AgentTypeConfig<
    XnewsAnalystResult,
    undefined,
    ContextSchema,
    readonly [],
    readonly StructuredToolInterface[],
    readonly []
  >
>;

export interface CreateXnewsAnalystOptions<
  ContextSchema extends InteropZodObject = typeof XnewsRuntimeContextSchema,
> {
  readonly model: BaseChatModel;
  readonly contextSchema?: ContextSchema | undefined;
  readonly systemPrompt?: string | undefined;
  readonly checkpointer?: XnewsCheckpointer | undefined;
  readonly tools?: readonly StructuredToolInterface[] | undefined;
  readonly resultSchema?: InteropZodType<XnewsAnalystResult> | undefined;
}

export interface XnewsAnalystState {
  readonly messages: readonly BaseMessage[];
  readonly structuredResponse?: XnewsAnalystResult | undefined;
}

/** Returns the native createAgent graph, including invoke/stream/streamEvents interfaces. */
export function createXnewsAnalyst<ContextSchema extends InteropZodObject>(
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
    responseFormat: toolStrategy(options.resultSchema ?? XnewsAnalystResultSchema),
    ...(options.checkpointer === undefined ? {} : { checkpointer: options.checkpointer }),
  });
}
