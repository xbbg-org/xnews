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
