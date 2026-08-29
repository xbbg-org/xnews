import { expect, test } from "bun:test";
import { ToolMessage } from "@langchain/core/messages";

import {
  citationRef,
  collectXnewsEvidence,
  createXnewsToolOutput,
  resolveXnewsCitation,
} from "../src/index.js";
import { isRecord } from "../src/type-guards.js";

// Measured live: a news id is `provider|guid|title` and runs past 260 characters, so every model
// cited the `provider|guid` prefix instead and no citation matched the id it had been shown.
const LONG_ID =
  "google-news|CBMifEFVX3lxTFBZMDY3TVNCdDRkUURTVjFlUVVybWgwR2U5bmM3VHNVLVl6T09NR210S3hILWhY|Strengthening the U.S. Export Control Regime - The Foundation for American Innovation";
const PREFIX = LONG_ID.split("|").slice(0, 2).join("|");

function newsDigest(): ToolMessage {
  const [content, artifact] = createXnewsToolOutput({
    tool: "xnews_news",
    operation: "topic",
    status: "ok",
    data: { items: [] },
    items: [
      {
        id: LONG_ID,
        title: "Strengthening the U.S. Export Control Regime",
        url: "https://news.google.com/rss/articles/CBMifEFVX3lxTFBZ?oc=5",
        provider: "google-news",
        publishedAt: "2026-08-27T07:15:20.000Z",
      },
    ],
    counts: { items: 1 },
    context: {},
  });
  return new ToolMessage({ content, artifact, tool_call_id: "news-1", name: "xnews_news" });
}

test("digest items carry a short citation ref derived from the item id", () => {
  const message = newsDigest();
  const content: unknown = message.content;
  const digest: unknown = typeof content === "string" ? JSON.parse(content) : undefined;
  const item = isRecord(digest) && Array.isArray(digest["items"]) ? digest["items"][0] : undefined;
  expect(isRecord(item)).toBeTrue();
  if (!isRecord(item)) return;

  expect(item["ref"]).toBe(citationRef(LONG_ID));
  expect(String(item["ref"])).toHaveLength(12);
  // Derived, not assigned, so identical tool output stays byte-identical.
  expect(citationRef(LONG_ID)).toBe(citationRef(LONG_ID));
  expect(citationRef(LONG_ID)).not.toBe(citationRef(PREFIX));
});

test("a citation resolves from a ref, a full id, or the prefix a model truncates to", () => {
  const evidence = collectXnewsEvidence([newsDigest()]);
  for (const citation of [citationRef(LONG_ID), LONG_ID, PREFIX]) {
    const resolved = resolveXnewsCitation(citation, evidence);
    expect(resolved?.id, `resolves ${citation.slice(0, 20)}`).toBe(LONG_ID);
    expect(resolved?.url).toBe("https://news.google.com/rss/articles/CBMifEFVX3lxTFBZ?oc=5");
    expect(resolved?.provider).toBe("google-news");
    expect(resolved?.tool).toBe("xnews_news");
  }
  expect(resolveXnewsCitation("not-a-citation", evidence)).toBeUndefined();
});

test("evidence collection ignores messages that are not tool digests", () => {
  const evidence = collectXnewsEvidence([
    new ToolMessage({ content: "not json", tool_call_id: "x", name: "xnews_news" }),
    new ToolMessage({ content: '{"items":"not-an-array"}', tool_call_id: "y", name: "xnews_news" }),
  ]);
  expect(evidence.size).toBe(0);
});

// A summary truncates any string past 512 characters. Hashing the truncated copy would produce a
// ref the host could never recompute from the record it holds.
test("the ref survives an id longer than the summary truncation limit", () => {
  const hugeId = `google-news|${"A".repeat(600)}|Some very long headline`;
  const [content] = createXnewsToolOutput({
    tool: "xnews_news",
    operation: "topic",
    status: "ok",
    data: { items: [] },
    items: [{ id: hugeId, title: "Some very long headline", provider: "google-news" }],
    counts: { items: 1 },
    context: {},
  });
  const digest: unknown = JSON.parse(content);
  const item = isRecord(digest) && Array.isArray(digest["items"]) ? digest["items"][0] : undefined;
  expect(isRecord(item)).toBeTrue();
  if (!isRecord(item)) return;

  // The id the model sees is truncated; the ref is not derived from that truncation.
  expect(String(item["id"])).toEndWith("…");
  expect(item["ref"]).toBe(citationRef(hugeId));
  expect(item["ref"]).not.toBe(citationRef(String(item["id"])));

  const evidence = collectXnewsEvidence([
    new ToolMessage({ content, tool_call_id: "huge", name: "xnews_news" }),
  ]);
  expect(resolveXnewsCitation(citationRef(hugeId), evidence)?.provider).toBe("google-news");
});
