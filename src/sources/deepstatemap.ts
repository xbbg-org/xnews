import { fetchJsonText } from "../http.js";
import { isRecord, stringField } from "../json.js";
import { DEEP_STATE_MAP_FRONTLINE_URL } from "./deepstatemap.urls.js";
import type { SourceFetchOptions } from "../types.js";

export { DEEP_STATE_MAP_FRONTLINE_URL } from "./deepstatemap.urls.js";

const DEEP_STATE_MAP_SHAPE_ERROR = "unexpected DeepStateMap history response shape";

export interface FrontlineFeature {
  readonly name: string;
  readonly nameEn?: string;
  readonly description?: string;
  readonly geometryType: string;
  /** GeoJSON nesting is retained verbatim and is not traversed or rewritten. */
  readonly coordinates: readonly unknown[];
}

export interface FrontlineSnapshot {
  readonly id: string | number;
  readonly createdAt: string;
  readonly features: readonly FrontlineFeature[];
}

/** Fetches the latest DeepStateMap territorial-control polygons. */
export async function fetchDeepStateMapFrontline(
  options: SourceFetchOptions = {},
): Promise<FrontlineSnapshot> {
  const body = await fetchJsonText(DEEP_STATE_MAP_FRONTLINE_URL, options);
  return parseDeepStateMapFrontline(body);
}

/** Parses a DeepStateMap history envelope without reducing its polygon geometry. */
export function parseDeepStateMapFrontline(body: string): FrontlineSnapshot {
  const root = parseRoot(body);
  const id = snapshotId(root["id"]);
  const map = root["map"];
  if (!isRecord(map) || map["type"] !== "FeatureCollection") {
    throw new Error(DEEP_STATE_MAP_SHAPE_ERROR);
  }
  const mapFeatures = map["features"];
  if (!Array.isArray(mapFeatures)) {
    throw new Error(DEEP_STATE_MAP_SHAPE_ERROR);
  }

  const createdAt = snapshotCreatedAt(root, id);
  if (createdAt === undefined) throw new Error(DEEP_STATE_MAP_SHAPE_ERROR);

  const features: FrontlineFeature[] = [];
  for (const candidate of mapFeatures) {
    if (!isRecord(candidate)) continue;
    const properties = candidate["properties"];
    const geometry = candidate["geometry"];
    if (!isRecord(properties) || !isRecord(geometry)) continue;

    const rawName = stringField(properties, "name")?.trim();
    const geometryType = stringField(geometry, "type")?.trim();
    const coordinates = geometry["coordinates"];
    if (!rawName || !geometryType || !Array.isArray(coordinates)) continue;

    const { name, nameEn } = splitBilingualName(rawName);
    if (!name) continue;
    const description = stringField(properties, "description")?.trim();
    features.push({
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(description ? { description } : {}),
      geometryType,
      // The nested GeoJSON array is intentionally retained, not copied into a
      // centroid: territorial extent is the observation this source publishes.
      coordinates,
    });
  }

  return { id, createdAt, features };
}

function parseRoot(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(DEEP_STATE_MAP_SHAPE_ERROR);
  }
  if (!isRecord(parsed)) throw new Error(DEEP_STATE_MAP_SHAPE_ERROR);
  return parsed;
}

function snapshotId(value: unknown): string | number {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(DEEP_STATE_MAP_SHAPE_ERROR);
}

function snapshotCreatedAt(root: Record<string, unknown>, id: string | number): string | undefined {
  const stated = stringField(root, "createdAt") ?? stringField(root, "datetime");
  if (stated?.trim()) return stated.trim();

  // The live endpoint currently sometimes omits its timestamp while keeping
  // the history id as Unix seconds. This preserves a meaningful snapshot time
  // without fabricating one from the local clock.
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return undefined;
  const date = new Date(id * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function splitBilingualName(rawName: string): {
  readonly name: string;
  readonly nameEn?: string;
} {
  const separator = rawName.indexOf("///");
  if (separator < 0) return { name: rawName.trim() };

  const name = rawName.slice(0, separator).trim();
  const remainder = rawName.slice(separator + 3);
  const nextSeparator = remainder.indexOf("///");
  const nameEn = (nextSeparator < 0 ? remainder : remainder.slice(0, nextSeparator)).trim();
  if (!name) return { name: nameEn };
  return nameEn ? { name, nameEn } : { name };
}
