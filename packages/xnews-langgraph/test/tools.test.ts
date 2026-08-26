import { expect, test } from "bun:test";
import { ToolMessage } from "@langchain/core/messages";
import type { DataSource } from "@xbbg/xnews";
import { z } from "zod";

import { createXnewsTools } from "../src/index.js";

const ToolArtifactSchema = z.object({
  digest: z.object({
    counts: z.record(z.string(), z.number()),
    omissions: z.object({ items: z.number() }),
  }),
  data: z.unknown(),
});
const DataEnvelopeSchema = z.object({
  release: z.object({ rows: z.array(z.unknown()), url: z.string() }),
  requestUrls: z.array(z.string()),
});
const NewsEnvelopeSchema = z.object({
  items: z.array(z.object({ title: z.string() })),
});

function toolNamed(name: string) {
  const selected = createXnewsTools({
    digestCaps: { xnews_data: { maxItems: 1, maxCharacters: 2_000 } },
  }).find((candidate) => candidate.name === name);
  if (selected === undefined) throw new Error(`Missing tool ${name}`);
  return selected;
}

async function expectRejection(promise: PromiseLike<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error("Expected promise to reject");
}

async function rejectionError(promise: PromiseLike<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected promise to reject");
}

test("data seam uses a host-bound source and preserves the full redacted envelope in artifact", async () => {
  const source: DataSource<unknown> = {
    provider: "fixture",
    dataset: "daily",
    requestUrls: () => ["https://data.test/releases?token=runtime-secret"],
    fetchRelease: async () => ({
      provider: "fixture",
      dataset: "daily",
      asOf: "2026-08-25",
      url: "https://data.test/releases?token=runtime-secret",
      rows: [
        { id: "a", value: 1 },
        { id: "b", value: 2 },
        { id: "c", value: 3 },
      ],
    }),
  };
  const result = await toolNamed("xnews_data").invoke(
    {
      type: "tool_call",
      id: "data-1",
      name: "xnews_data",
      args: { operation: "fetch", source: "daily" },
    },
    {
      context: {
        dataSources: { daily: source },
        credentials: { byProvider: { fixture: "runtime-secret" } },
      },
    },
  );

  expect(ToolMessage.isInstance(result)).toBe(true);
  if (!ToolMessage.isInstance(result)) throw new Error("Expected ToolMessage");
  const content: unknown = result.content;
  if (typeof content !== "string" && !Array.isArray(content))
    throw new Error("Expected string or array ToolMessage content");
  expect(typeof content === "string" ? content : JSON.stringify(content)).not.toContain(
    "runtime-secret",
  );
  const artifact = ToolArtifactSchema.parse(result.artifact);
  expect(artifact.digest.counts["rows"]).toBe(3);
  expect(artifact.digest.omissions.items).toBe(2);
  const envelope = DataEnvelopeSchema.parse(artifact.data);
  expect(envelope.release.rows).toHaveLength(3);
  expect(envelope.release.url).not.toContain("runtime-secret");
  expect(envelope.requestUrls.join(" ")).not.toContain("runtime-secret");
});

test("news seam honors injected fetch without exposing runtime configuration in arguments", async () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>Fixture market update</title>
    <link>https://news.test/story</link>
    <guid>fixture-1</guid>
    <pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate>
  </item></channel></rss>`;
  let calls = 0;
  const result = await toolNamed("xnews_news").invoke(
    {
      type: "tool_call",
      id: "news-1",
      name: "xnews_news",
      args: {
        operation: "topic",
        query: "markets",
        sources: ["bing-news"],
        limit: 2,
      },
    },
    {
      context: {
        fetch: async () => {
          calls += 1;
          return new Response(xml, { headers: { "Content-Type": "application/rss+xml" } });
        },
      },
    },
  );

  expect(calls).toBe(1);
  expect(ToolMessage.isInstance(result)).toBe(true);
  if (!ToolMessage.isInstance(result)) throw new Error("Expected ToolMessage");
  const artifact = ToolArtifactSchema.parse(result.artifact);
  const envelope = NewsEnvelopeSchema.parse(artifact.data);
  expect(envelope.items[0]?.title).toBe("Fixture market update");
});

test("files seam rejects model-supplied records and direct URLs before transport", async () => {
  let calls = 0;
  const tool = toolNamed("xnews_files");
  const runtime = {
    context: {
      fetch: async () => {
        calls += 1;
        return new Response("unexpected");
      },
      credentials: { annasArchiveKey: "host-secret" },
    },
  };

  await expectRejection(
    tool.invoke(
      {
        type: "tool_call",
        id: "files-record",
        name: "xnews_files",
        args: {
          operation: "resolve",
          record: {
            provider: "annas-archive",
            sourceId: "forged",
            title: "Forged",
            authors: [],
            identity: { origin: "record", confidence: 1 },
            availability: "full-text",
            url: "https://attacker.test/works/forged",
            warnings: [],
            provenance: [],
          },
        },
      },
      runtime,
    ),
  );

  await expectRejection(
    tool.invoke(
      {
        type: "tool_call",
        id: "files-url",
        name: "xnews_files",
        args: {
          operation: "download_url",
          url: "http://127.0.0.1/private",
        },
      },
      runtime,
    ),
  );

  expect(calls).toBe(0);
});

test("files seam resolves only host-bound work-file keys", async () => {
  const requested: string[] = [];
  const result = await toolNamed("xnews_files").invoke(
    {
      type: "tool_call",
      id: "files-bound",
      name: "xnews_files",
      args: { operation: "download_file", file: "approved-report" },
    },
    {
      context: {
        workFiles: {
          "approved-report": {
            provider: "fixture",
            label: "approved report",
            url: "https://files.test/report.txt",
            fileName: "report.txt",
            format: "txt",
          },
        },
        fetch: async (url: string | URL | Request) => {
          requested.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
          return new Response("approved");
        },
      },
    },
  );

  expect(requested).toEqual(["https://files.test/report.txt"]);
  expect(ToolMessage.isInstance(result)).toBe(true);
});

test("invalid runtime context rejects without echoing operator values", async () => {
  const error = await rejectionError(
    toolNamed("xnews_catalog").invoke(
      {
        type: "tool_call",
        id: "invalid-context",
        name: "xnews_catalog",
        args: { operation: "capabilities" },
      },
      { context: { redirect: "operator-private-value" } },
    ),
  );

  expect(error.message).toBe("Invalid xnews runtime context");
  expect(error.message).not.toContain("operator-private-value");
});
