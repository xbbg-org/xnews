import { expect, test } from "bun:test";
import { BaseChatModel, type BindToolsInput } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { DataSource } from "@xbbg/xnews";

import { XNEWS_TOOL_NAMES, XnewsAnalystResultSchema, createXnewsAnalyst } from "../src/index.js";
import { isRecord } from "../src/type-guards.js";

class ScriptedToolModel extends BaseChatModel {
  #tools: BindToolsInput[] = [];

  _llmType(): string {
    return "scripted-xnews";
  }

  override bindTools(tools: BindToolsInput[]): this {
    this.#tools = tools;
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const toolMessages = messages.filter((message) => ToolMessage.isInstance(message));
    if (toolMessages.length === 0) {
      return responseWithToolCall("xnews_catalog", { operation: "capabilities" }, "catalog-1");
    }
    if (toolMessages.length === 1) {
      return responseWithToolCall(
        "xnews_data",
        { operation: "fetch", source: "fixture" },
        "data-1",
      );
    }
    const structuredTool = this.#tools
      .map(boundToolName)
      .find(
        (name) => name !== undefined && !(XNEWS_TOOL_NAMES as readonly string[]).includes(name),
      );
    if (structuredTool === undefined) throw new Error("Structured response tool was not bound");
    return responseWithToolCall(
      structuredTool,
      {
        summary: "The fixture release contains one observation.",
        claims: [
          {
            statement: "One observation is available.",
            evidence: ["fixture:daily"],
            confidence: 1,
          },
        ],
        sources: [{ id: "fixture:daily", provider: "fixture", url: "https://data.test/daily" }],
        uncertainty: [],
        limitations: ["Fixture-only analysis."],
        providerDiagnostics: [{ provider: "fixture", status: "ok", warningCount: 0 }],
        generatedAt: "2026-08-25T12:00:00.000Z",
      },
      "structured-1",
    );
  }
}

function boundToolName(tool: BindToolsInput): string | undefined {
  if (typeof tool !== "object" || tool === null) return undefined;
  if ("name" in tool && typeof tool.name === "string") return tool.name;
  if (
    "function" in tool &&
    typeof tool.function === "object" &&
    tool.function !== null &&
    "name" in tool.function &&
    typeof tool.function.name === "string"
  )
    return tool.function.name;
  return undefined;
}

function responseWithToolCall(name: string, args: Record<string, unknown>, id: string): ChatResult {
  const message = new AIMessage({
    content: "",
    tool_calls: [{ name, args, id, type: "tool_call" }],
  });
  return { generations: [{ text: "", message }] };
}

test("provider-agnostic analyst preserves tool artifacts and validates structured response", async () => {
  const source: DataSource<unknown> = {
    provider: "fixture",
    dataset: "daily",
    requestUrls: () => ["https://data.test/daily"],
    fetchRelease: async () => ({
      provider: "fixture",
      dataset: "daily",
      asOf: "2026-08-25",
      url: "https://data.test/daily",
      rows: [{ value: 1 }],
    }),
  };
  const analyst = createXnewsAnalyst({ model: new ScriptedToolModel({}) });
  const result = await analyst.invoke(
    { messages: [{ role: "user", content: "Analyze the fixture." }] },
    { context: { dataSources: { fixture: source } } },
  );

  expect(result.messages.length).toBeGreaterThanOrEqual(6);
  const toolMessages = result.messages.filter((message) => ToolMessage.isInstance(message));
  expect(toolMessages).toHaveLength(3);
  const dataMessage = toolMessages.find((message) => message.name === "xnews_data");
  if (dataMessage === undefined) throw new Error("Expected xnews_data ToolMessage");
  const artifact: unknown = dataMessage.artifact;
  if (!isRecord(artifact)) throw new Error("Expected xnews_data artifact");
  const digest = artifact["digest"];
  if (!isRecord(digest)) throw new Error("Expected xnews_data artifact digest");
  const counts = digest["counts"];
  if (!isRecord(counts)) throw new Error("Expected xnews_data digest counts");
  expect(counts["rows"]).toBe(1);
  expect(XnewsAnalystResultSchema.parse(result.structuredResponse)).toEqual(
    result.structuredResponse,
  );
  expect(result.structuredResponse.summary).toContain("one observation");
});

/**
 * `AgentNode` copies the parsed structured output into `structuredResponse`, a
 * `ToolMessage`, and a closing `AIMessage`, and a checkpointer persists all three. The
 * result schema's transforms therefore have to run inside the response strategy, not after
 * the agent, or a credential-bearing URL is stored verbatim. Public contact details in the
 * cited record are not the operator's data and stay readable.
 */
class LeakingResultModel extends BaseChatModel {
  #tools: BindToolsInput[] = [];

  _llmType(): string {
    return "leaking-xnews";
  }

  override bindTools(tools: BindToolsInput[]): this {
    this.#tools = tools;
    return this;
  }

  async _generate(): Promise<ChatResult> {
    const structuredTool = this.#tools
      .map(boundToolName)
      .find(
        (name) => name !== undefined && !(XNEWS_TOOL_NAMES as readonly string[]).includes(name),
      );
    if (structuredTool === undefined) throw new Error("Structured response tool was not bound");
    return responseWithToolCall(
      structuredTool,
      {
        summary: "Contact analyst@example.com for the raw file.",
        claims: [
          {
            statement: "The desk replied from analyst@example.com.",
            evidence: ["mailto:analyst@example.com"],
            confidence: 0.5,
          },
        ],
        sources: [
          {
            id: "fixture:leak",
            provider: "fixture",
            url: "https://data.test/daily?api_key=super-secret-token",
          },
        ],
        uncertainty: [],
        limitations: ["Fixture-only analysis."],
        providerDiagnostics: [{ provider: "fixture", status: "ok", warningCount: 0 }],
        generatedAt: "2026-08-25T12:00:00.000Z",
      },
      "structured-leak",
    );
  }
}

test("credentials are redacted in every derived copy and public content survives", async () => {
  const analyst = createXnewsAnalyst({ model: new LeakingResultModel({}) });
  const result = await analyst.invoke(
    { messages: [{ role: "user", content: "Summarize the fixture." }] },
    { context: {} },
  );

  // The agent derives three copies from the parsed result: the structured response, a
  // ToolMessage carrying its JSON, and the closing AIMessage. A checkpointer persists all
  // three, so all three must be the transformed value.
  const finalMessage = result.messages.at(-1);
  const derived = [
    JSON.stringify(result.structuredResponse),
    JSON.stringify(finalMessage?.content),
    ...result.messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => JSON.stringify(message.content)),
  ];
  for (const copy of derived) {
    expect(copy, "derived copy leaks a credential").not.toContain("super-secret-token");
  }
  // A redacted URL keeps its shape, so the marker arrives percent-encoded.
  expect(result.structuredResponse.sources[0]?.url).toContain("%5BREDACTED%5D");
  // The cited record's own contact address is public data, not operator PII.
  expect(result.structuredResponse.summary).toContain("analyst@example.com");
});

// Two of three live providers dated a 2026 result to 2024: a model reports its training
// era, not the clock, so the runtime stamps the field.
test("the analyst stamps generatedAt instead of trusting the model", async () => {
  const before = Date.now();
  const analyst = createXnewsAnalyst({ model: new LeakingResultModel({}) });
  const result = await analyst.invoke(
    { messages: [{ role: "user", content: "Summarize the fixture." }] },
    { context: {} },
  );

  // The scripted model returns 2026-08-25T12:00:00.000Z.
  const stamped = Date.parse(result.structuredResponse.generatedAt);
  expect(Number.isNaN(stamped)).toBeFalse();
  expect(stamped).toBeGreaterThanOrEqual(before);
  expect(stamped).toBeLessThanOrEqual(Date.now());
});

/** Records the system prompt each model call receives. */
class PromptCapturingModel extends BaseChatModel {
  readonly systemPrompts: string[] = [];
  #tools: BindToolsInput[] = [];

  _llmType(): string {
    return "prompt-capturing-xnews";
  }

  override bindTools(tools: BindToolsInput[]): this {
    this.#tools = tools;
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    // A dynamic system prompt arrives as content blocks beside the static one.
    const system = messages.find((message) => message.getType() === "system");
    const content: unknown = system?.content;
    if (typeof content === "string") this.systemPrompts.push(content);
    else if (Array.isArray(content)) {
      this.systemPrompts.push(
        content
          .map((block) =>
            isRecord(block) && typeof block["text"] === "string" ? block["text"] : "",
          )
          .join("\n"),
      );
    }
    const structuredTool = this.#tools
      .map(boundToolName)
      .find(
        (name) => name !== undefined && !(XNEWS_TOOL_NAMES as readonly string[]).includes(name),
      );
    if (structuredTool === undefined) throw new Error("Structured response tool was not bound");
    return responseWithToolCall(
      structuredTool,
      {
        summary: "Fixture summary.",
        claims: [{ statement: "One claim.", evidence: ["fixture"], confidence: 1 }],
        sources: [{ id: "fixture", provider: "fixture" }],
        uncertainty: [],
        limitations: ["Fixture-only analysis."],
        providerDiagnostics: [{ provider: "fixture", status: "ok", warningCount: 0 }],
        generatedAt: "2024-01-01T00:00:00.000Z",
      },
      "structured-prompt",
    );
  }
}

// Without a clock, gemini-2.5-flash called live 2026 articles "predictive or speculative"
// and dated its own result to 2024. The rule travels with the date, so a host that replaces
// the system prompt still gets it.
test("each model call carries the current date and the freshness rule", async () => {
  const today = new Date().toISOString().slice(0, 10);

  const withDefault = new PromptCapturingModel({});
  await createXnewsAnalyst({ model: withDefault }).invoke(
    { messages: [{ role: "user", content: "Summarize the fixture." }] },
    { context: {} },
  );
  const custom = new PromptCapturingModel({});
  await createXnewsAnalyst({ model: custom, systemPrompt: "Answer tersely." }).invoke(
    { messages: [{ role: "user", content: "Summarize the fixture." }] },
    { context: {} },
  );

  for (const [label, model] of [
    ["default prompt", withDefault],
    ["custom prompt", custom],
  ] as const) {
    const prompt = model.systemPrompts.at(0) ?? "";
    expect(prompt, `${label} carries the date`).toContain(`The current date is ${today} (UTC)`);
    expect(prompt, `${label} carries the rule`).toContain("judge them against the current date");
    expect(prompt, `${label} allows real skepticism`).toContain("malformed or inconsistent");
  }
  expect(custom.systemPrompts.at(0)).toContain("Answer tersely.");
});
