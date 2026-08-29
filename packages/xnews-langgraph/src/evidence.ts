/**
 * Resolves a citation back to the record the tools actually returned.
 *
 * A news item's id is `provider|guid|title`, hundreds of characters long, and a model asked to
 * cite it truncates at the `provider|guid` boundary: in live runs across three providers every
 * cited id failed an exact match against the id the model had been shown, and every one matched
 * after the trailing title was stripped. Hosts should not have to rediscover that. Each digest
 * item now carries a short `ref`, and this index accepts a ref, a full id, or the truncated
 * prefix so citations from any of those forms resolve to the same record.
 */
import { ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { citationRef } from "./digest.js";
import { isRecord } from "./type-guards.js";

export interface XnewsEvidenceItem {
  /** Short handle carried by the digest item the model saw. */
  readonly ref: string;
  readonly id: string;
  readonly title?: string | undefined;
  readonly url?: string | undefined;
  readonly provider?: string | undefined;
  readonly publishedAt?: string | undefined;
  readonly tool?: string | undefined;
}

function stringField(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

/**
 * Indexes every item the tools reported, keyed by ref, full id, and `provider|guid` prefix.
 *
 * Reads the model-facing digest rather than the host-only artifact: a model can only cite what it
 * was shown, and the digest is already bounded and redacted.
 */
export function collectXnewsEvidence(
  messages: readonly BaseMessage[],
): ReadonlyMap<string, XnewsEvidenceItem> {
  const evidence = new Map<string, XnewsEvidenceItem>();
  // A prefix key is a guess, not an identity: the same guid republished under a revised headline
  // yields two records sharing `provider|guid`. Keeping the first would cite the wrong one while
  // looking exact, so a contested prefix is dropped and its citation reads as unresolved.
  const prefixOwners = new Map<string, Set<string>>();

  for (const message of messages) {
    if (!ToolMessage.isInstance(message) || typeof message.content !== "string") continue;
    let digest: unknown;
    try {
      digest = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!isRecord(digest)) continue;
    const items = digest["items"];
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (!isRecord(item)) continue;
      const id = stringField(item, "id");
      if (id === undefined) continue;
      const entry: XnewsEvidenceItem = {
        ref: stringField(item, "ref") ?? citationRef(id),
        id,
        title: stringField(item, "title"),
        url: stringField(item, "url"),
        provider: stringField(item, "provider"),
        publishedAt: stringField(item, "publishedAt"),
        tool: stringField(digest, "tool"),
      };
      // The ref and the full id identify one record; both are exact.
      for (const key of [entry.ref, id]) {
        if (key.length > 0 && !evidence.has(key)) evidence.set(key, entry);
      }
      const prefix = id.split("|").slice(0, 2).join("|");
      if (prefix.length === 0 || prefix === id) continue;
      const owners = prefixOwners.get(prefix) ?? new Set<string>();
      owners.add(entry.ref);
      prefixOwners.set(prefix, owners);
      if (!evidence.has(prefix)) evidence.set(prefix, entry);
    }
  }

  for (const [prefix, owners] of prefixOwners) {
    // An exact id equal to this prefix keeps its own record; only the guess is dropped.
    const claimed = evidence.get(prefix);
    if (owners.size > 1 && claimed !== undefined && claimed.id !== prefix) evidence.delete(prefix);
  }
  return evidence;
}

/** Resolves one citation written as a ref, a full id, or a truncated id prefix. */
export function resolveXnewsCitation(
  citation: string,
  evidence: ReadonlyMap<string, XnewsEvidenceItem>,
): XnewsEvidenceItem | undefined {
  return evidence.get(citation) ?? evidence.get(citation.split("|").slice(0, 2).join("|"));
}
