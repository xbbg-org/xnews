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
  // A ref is a hash of the item id, so one ref naming two ids means a collision, not a record.
  const refOwners = new Map<string, Set<string>>();
  // An id is unique only within its provider, so a contested id names no single record either.
  const idOwners = new Map<string, Set<string>>();

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
      const tool = stringField(digest, "tool");
      const provider = stringField(item, "provider");
      const scope = {
        tool: tool ?? "",
        id,
        ...(provider === undefined ? {} : { provider }),
      };
      const entry: XnewsEvidenceItem = {
        ref: stringField(item, "ref") ?? citationRef(scope),
        id,
        title: stringField(item, "title"),
        url: stringField(item, "url"),
        provider,
        publishedAt: stringField(item, "publishedAt"),
        tool,
      };

      // A ref names one identity. Two identities under one ref is a collision, not a record.
      const identity = [scope.tool, provider ?? "", id].join("\u0000");
      const refIdentities = refOwners.get(entry.ref) ?? new Set<string>();
      refIdentities.add(identity);
      refOwners.set(entry.ref, refIdentities);
      // A bare id is unique only within its provider: an `across` result can carry alert `1` from
      // two providers, and citing `1` names neither.
      const idRefs = idOwners.get(id) ?? new Set<string>();
      idRefs.add(entry.ref);
      idOwners.set(id, idRefs);

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
  for (const [ref, identities] of refOwners) {
    if (identities.size > 1) evidence.delete(ref);
  }
  for (const [id, refs] of idOwners) {
    if (refs.size > 1) evidence.delete(id);
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
