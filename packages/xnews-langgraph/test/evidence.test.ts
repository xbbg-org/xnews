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

/** Every fixture here is a news item from `google-news`, so the scope is fixed. */
function newsRef(id: string): string {
  return citationRef({ tool: "xnews_news", provider: "google-news", id });
}

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

  expect(item["ref"]).toBe(newsRef(LONG_ID));
  expect(String(item["ref"])).toHaveLength(24);
  // Derived, not assigned, so identical tool output stays byte-identical.
  expect(newsRef(LONG_ID)).toBe(newsRef(LONG_ID));
  expect(newsRef(LONG_ID)).not.toBe(newsRef(PREFIX));
});

test("a citation resolves from a ref, a full id, or the prefix a model truncates to", () => {
  const evidence = collectXnewsEvidence([newsDigest()]);
  for (const citation of [newsRef(LONG_ID), LONG_ID, PREFIX]) {
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
  expect(item["ref"]).toBe(newsRef(hugeId));
  expect(item["ref"]).not.toBe(newsRef(String(item["id"])));

  const evidence = collectXnewsEvidence([
    new ToolMessage({ content, tool_call_id: "huge", name: "xnews_news" }),
  ]);
  expect(resolveXnewsCitation(newsRef(hugeId), evidence)?.provider).toBe("google-news");
});

// The same guid republished under a revised headline yields two records sharing the prefix a
// model truncates to. Resolving that to whichever arrived first would cite the wrong record while
// looking exact.
test("a prefix claimed by two records resolves to neither", () => {
  const guid = "google-news|CBMiRefreshedGuid";
  const first = `${guid}|Chip curbs tightened`;
  const second = `${guid}|Chip curbs tightened, allies join`;
  const [content] = createXnewsToolOutput({
    tool: "xnews_news",
    operation: "topic",
    status: "ok",
    data: { items: [] },
    items: [
      {
        id: first,
        title: "Chip curbs tightened",
        url: "https://news.test/v1",
        provider: "google-news",
      },
      {
        id: second,
        title: "Chip curbs tightened, allies join",
        url: "https://news.test/v2",
        provider: "google-news",
      },
    ],
    counts: { items: 2 },
    context: {},
  });
  const evidence = collectXnewsEvidence([
    new ToolMessage({ content, tool_call_id: "dupe", name: "xnews_news" }),
  ]);

  // Each record still resolves by its own ref and by its own full id.
  expect(resolveXnewsCitation(newsRef(first), evidence)?.url).toBe("https://news.test/v1");
  expect(resolveXnewsCitation(newsRef(second), evidence)?.url).toBe("https://news.test/v2");
  expect(resolveXnewsCitation(first, evidence)?.url).toBe("https://news.test/v1");
  expect(resolveXnewsCitation(second, evidence)?.url).toBe("https://news.test/v2");
  // The contested prefix answers for neither.
  expect(resolveXnewsCitation(guid, evidence)).toBeUndefined();
});

test("an id that is itself a prefix keeps its record when another id extends it", () => {
  const bare = "google-news|CBMiSharedGuid";
  const extended = `${bare}|A later headline`;
  const [content] = createXnewsToolOutput({
    tool: "xnews_news",
    operation: "topic",
    status: "ok",
    data: { items: [] },
    items: [
      { id: bare, title: "Bare", url: "https://news.test/bare", provider: "google-news" },
      {
        id: extended,
        title: "Extended",
        url: "https://news.test/extended",
        provider: "google-news",
      },
    ],
    counts: { items: 2 },
    context: {},
  });
  const evidence = collectXnewsEvidence([
    new ToolMessage({ content, tool_call_id: "shared", name: "xnews_news" }),
  ]);

  expect(resolveXnewsCitation(bare, evidence)?.url).toBe("https://news.test/bare");
  expect(resolveXnewsCitation(extended, evidence)?.url).toBe("https://news.test/extended");
});

// `ref` is the handle a citation resolves through, and provider payloads are attacker-influenced.
test("an upstream ref never becomes the citation handle", () => {
  const id = "google-news|CBMiOwnRef|Headline";
  const [content] = createXnewsToolOutput({
    tool: "xnews_news",
    operation: "topic",
    status: "ok",
    data: { items: [] },
    items: [
      {
        id,
        ref: "attacker-chosen",
        title: "Headline",
        url: "https://news.test/x",
        provider: "google-news",
      },
    ],
    counts: { items: 1 },
    context: {},
  });
  const digest: unknown = JSON.parse(content);
  const item = isRecord(digest) && Array.isArray(digest["items"]) ? digest["items"][0] : undefined;
  expect(isRecord(item) ? item["ref"] : undefined).toBe(newsRef(id));

  const evidence = collectXnewsEvidence([
    new ToolMessage({ content, tool_call_id: "own-ref", name: "xnews_news" }),
  ]);
  expect(resolveXnewsCitation("attacker-chosen", evidence)).toBeUndefined();
  expect(resolveXnewsCitation(newsRef(id), evidence)?.url).toBe("https://news.test/x");
});

/** A digest presenting one handle for two different ids is a collision, not a record. */
function forgedDigest(id: string, url: string): ToolMessage {
  return new ToolMessage({
    content: JSON.stringify({ tool: "xnews_news", items: [{ id, ref: "collided", url }] }),
    tool_call_id: id,
    name: "xnews_news",
  });
}

test("one ref naming two records resolves to neither", () => {
  const evidence = collectXnewsEvidence([
    forgedDigest("google-news|one|A", "https://news.test/one"),
    forgedDigest("google-news|two|B", "https://news.test/two"),
  ]);

  expect(resolveXnewsCitation("collided", evidence)).toBeUndefined();
  expect(resolveXnewsCitation("google-news|one|A", evidence)?.url).toBe("https://news.test/one");
  expect(resolveXnewsCitation("google-news|two|B", evidence)?.url).toBe("https://news.test/two");
});

// An event id is unique only within its provider. An `across` result can carry alert `1` from two
// providers, and a bare id hash would have given them one handle.
test("two providers reporting the same id get distinct handles", () => {
  const [content] = createXnewsToolOutput({
    tool: "xnews_events",
    operation: "across",
    status: "ok",
    data: { events: [] },
    items: [
      { id: "1", provider: "nws", title: "Flood warning", url: "https://alerts.test/nws/1" },
      { id: "1", provider: "gdacs", title: "Cyclone alert", url: "https://alerts.test/gdacs/1" },
    ],
    counts: { events: 2 },
    context: {},
  });
  const digest: unknown = JSON.parse(content);
  const items = isRecord(digest) && Array.isArray(digest["items"]) ? digest["items"] : [];
  const refs = items.map((item) => (isRecord(item) ? item["ref"] : undefined));
  expect(new Set(refs).size, "each provider gets its own handle").toBe(2);

  const evidence = collectXnewsEvidence([
    new ToolMessage({ content, tool_call_id: "across", name: "xnews_events" }),
  ]);
  const nws = citationRef({ tool: "xnews_events", provider: "nws", id: "1" });
  const gdacs = citationRef({ tool: "xnews_events", provider: "gdacs", id: "1" });
  expect(resolveXnewsCitation(nws, evidence)?.url).toBe("https://alerts.test/nws/1");
  expect(resolveXnewsCitation(gdacs, evidence)?.url).toBe("https://alerts.test/gdacs/1");
  // The bare id names neither record, so it must not answer for one of them.
  expect(resolveXnewsCitation("1", evidence)).toBeUndefined();
});

// Not every record shape has an `id`. A works record names its identifier `sourceId`, and a data
// release row has no stable identity at all — inventing one would change the handle whenever the
// provider changed a column.
test("refs follow the identifier a record actually has", () => {
  const [worksContent] = createXnewsToolOutput({
    tool: "xnews_works",
    operation: "search",
    status: "ok",
    data: { items: [] },
    items: [{ sourceId: "openlibrary:OL123M", provider: "openlibrary", title: "A Work" }],
    counts: { items: 1 },
    context: {},
  });
  const worksDigest: unknown = JSON.parse(worksContent);
  const work =
    isRecord(worksDigest) && Array.isArray(worksDigest["items"])
      ? worksDigest["items"][0]
      : undefined;
  expect(isRecord(work) ? work["ref"] : undefined).toBe(
    citationRef({ tool: "xnews_works", provider: "openlibrary", id: "openlibrary:OL123M" }),
  );
  const worksEvidence = collectXnewsEvidence([
    new ToolMessage({ content: worksContent, tool_call_id: "works", name: "xnews_works" }),
  ]);
  expect(resolveXnewsCitation("openlibrary:OL123M", worksEvidence)?.title).toBe("A Work");

  const [rowContent] = createXnewsToolOutput({
    tool: "xnews_data",
    operation: "fetch",
    status: "ok",
    data: { release: { rows: [] } },
    items: [{ market: "wheat", netPosition: 1234 }],
    counts: { rows: 1 },
    context: {},
  });
  const rowDigest: unknown = JSON.parse(rowContent);
  const row =
    isRecord(rowDigest) && Array.isArray(rowDigest["items"]) ? rowDigest["items"][0] : undefined;
  expect(isRecord(row)).toBeTrue();
  // No stable identity, so no handle is invented and the row is still reported in full.
  expect(isRecord(row) ? row["ref"] : "missing").toBeUndefined();
  expect(isRecord(row) ? row["market"] : undefined).toBe("wheat");
});
