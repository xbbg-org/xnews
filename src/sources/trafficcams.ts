import { fetchJsonText } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringField } from "../json.js";
import { safeHttpUrl, toAbsoluteUrl } from "../text.js";
import {
  DELDOT_TRAFFIC_CAMERAS_URL,
  NYC_TRAFFIC_CAMERAS_URL,
  NZTA_TRAFFIC_CAMERAS_URL,
  TFL_TRAFFIC_CAMERAS_URL,
  TRAFFIC_NZ_BASE_URL,
} from "./trafficcams.urls.js";
import type { SourceFetchOptions } from "../types.js";
import type { ImplementedTrafficCameraNetwork, TrafficCameraNetwork } from "./trafficcams.urls.js";

export {
  DELDOT_TRAFFIC_CAMERAS_URL,
  NYC_TRAFFIC_CAMERAS_URL,
  NZTA_TRAFFIC_CAMERAS_URL,
  TFL_TRAFFIC_CAMERAS_URL,
  TRAFFIC_CAMERA_NETWORKS,
  TRAFFIC_NZ_BASE_URL,
} from "./trafficcams.urls.js";
export type {
  ImplementedTrafficCameraNetwork,
  TrafficCameraNetwork,
  TrafficCameraNetworkDefinition,
} from "./trafficcams.urls.js";

const NYC_SHAPE_ERROR = "unexpected NYC TMC camera response shape";
const TFL_SHAPE_ERROR = "unexpected TfL JamCam response shape";
const DELDOT_SHAPE_ERROR = "unexpected DelDOT camera response shape";
const NZTA_SHAPE_ERROR = "unexpected NZTA camera response shape";
const IMPLEMENTED_TRAFFIC_CAMERA_NETWORKS: readonly ImplementedTrafficCameraNetwork[] = [
  "nyc",
  "tfl",
  "deldot",
  "nzta",
];

/**
 * A current camera directory record. This source deliberately stays outside
 * the events lane: a camera is an observation endpoint, not an active event.
 */
export interface CameraRecord {
  readonly id: string;
  readonly network: TrafficCameraNetwork;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly imageUrl: string;
  readonly areaName?: string;
}

export interface TrafficCameraNetworkError {
  readonly network: ImplementedTrafficCameraNetwork;
  readonly message: string;
}

export interface TrafficCameraFetchResult {
  readonly cameras: readonly CameraRecord[];
  readonly errors: readonly TrafficCameraNetworkError[];
}

/** Fetches the online NYC TMC camera directory. */
export async function fetchNycTrafficCameras(
  options: SourceFetchOptions = {},
): Promise<CameraRecord[]> {
  return parseNycTrafficCameras(await fetchJsonText(NYC_TRAFFIC_CAMERAS_URL, options));
}

/** Fetches the London TfL JamCam directory. */
export async function fetchTflTrafficCameras(
  options: SourceFetchOptions = {},
): Promise<CameraRecord[]> {
  return parseTflTrafficCameras(await fetchJsonText(TFL_TRAFFIC_CAMERAS_URL, options));
}

/** Fetches the Delaware Department of Transportation camera directory. */
export async function fetchDelDotTrafficCameras(
  options: SourceFetchOptions = {},
): Promise<CameraRecord[]> {
  return parseDelDotTrafficCameras(await fetchJsonText(DELDOT_TRAFFIC_CAMERAS_URL, options));
}

/** Fetches the New Zealand traffic-camera directory. */
export async function fetchNztaTrafficCameras(
  options: SourceFetchOptions = {},
): Promise<CameraRecord[]> {
  return parseNztaTrafficCameras(await fetchJsonText(NZTA_TRAFFIC_CAMERAS_URL, options));
}

/**
 * Fetches selected implemented networks concurrently. A failed network is
 * reported alongside successful cameras instead of rejecting the batch.
 */
export async function fetchTrafficCameras(
  networks: readonly ImplementedTrafficCameraNetwork[] = IMPLEMENTED_TRAFFIC_CAMERA_NETWORKS,
  options: SourceFetchOptions = {},
): Promise<TrafficCameraFetchResult> {
  const outcomes = await Promise.all(
    networks.map(async (network): Promise<NetworkFetchOutcome> => {
      try {
        return { cameras: await CAMERA_FETCHERS[network](options) };
      } catch (error) {
        return {
          error: {
            network,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }),
  );

  return {
    cameras: outcomes.flatMap((outcome) => outcome.cameras ?? []),
    errors: outcomes.flatMap((outcome) => (outcome.error ? [outcome.error] : [])),
  };
}

/** Parses the NYC TMC bare camera array. Pure and network-free. */
export function parseNycTrafficCameras(body: string): CameraRecord[] {
  const cameras: CameraRecord[] = [];
  for (const record of parseBareRecordArray(body, NYC_SHAPE_ERROR)) {
    if (record["isOnline"] !== true && record["isOnline"] !== "true") continue;
    const camera = cameraRecord(record, "nyc", "latitude", "longitude", record["imageUrl"]);
    if (camera) cameras.push(camera);
  }
  return cameras;
}

/** Parses TfL cameras and extracts image URLs from additionalProperties. */
export function parseTflTrafficCameras(body: string): CameraRecord[] {
  const cameras: CameraRecord[] = [];
  for (const record of parseBareRecordArray(body, TFL_SHAPE_ERROR)) {
    const imageProperty = recordArray(record["additionalProperties"]).find(
      (property) => stringField(property, "key") === "imageUrl",
    );
    const camera = cameraRecord(
      record,
      "tfl",
      "lat",
      "lon",
      imageProperty?.["value"],
      "London, UK",
      "commonName",
    );
    if (camera) cameras.push(camera);
  }
  return cameras;
}

/** Parses DelDOT's camera envelope. */
export function parseDelDotTrafficCameras(body: string): CameraRecord[] {
  const root = parseJsonRecord(body, "DelDOT cameras");
  const videoCameras = root["videoCameras"];
  if (!Array.isArray(videoCameras)) throw new Error(DELDOT_SHAPE_ERROR);

  const cameras: CameraRecord[] = [];
  for (const record of recordArray(videoCameras)) {
    if (record["enabled"] === false) continue;
    const urls = isRecord(record["urls"]) ? record["urls"] : undefined;
    const imageUrl =
      record["imageUrl"] ??
      urls?.["imageUrl"] ??
      urls?.["m3u8s"] ??
      urls?.["m3u8"] ??
      record["url"];
    const areaName = stringField(record, "county")?.trim() || "Delaware";
    const camera = cameraRecord(
      record,
      "deldot",
      record["latitude"] === undefined ? "lat" : "latitude",
      record["longitude"] === undefined ? "lon" : "longitude",
      imageUrl,
      areaName,
      "title",
    );
    if (camera) cameras.push(camera);
  }
  return cameras;
}

/** Parses NZTA's camera envelope and resolves relative image URLs. */
export function parseNztaTrafficCameras(body: string): CameraRecord[] {
  const root = parseJsonRecord(body, "NZTA cameras");
  const response = root["response"];
  if (!isRecord(response) || !Array.isArray(response["camera"])) {
    throw new Error(NZTA_SHAPE_ERROR);
  }

  const cameras: CameraRecord[] = [];
  for (const record of recordArray(response["camera"])) {
    const rawImageUrl = stringField(record, "imageUrl");
    const imageUrl = rawImageUrl ? absoluteTrafficNzUrl(rawImageUrl) : undefined;
    const regionRecord = record["region"];
    const region = isRecord(regionRecord)
      ? stringField(regionRecord, "name")?.trim()
      : stringField(record, "region")?.trim();
    const camera = cameraRecord(
      record,
      "nzta",
      "latitude",
      "longitude",
      imageUrl,
      region || "New Zealand",
      stringField(record, "description")?.trim() ? "description" : "name",
    );
    if (camera) cameras.push(camera);
  }
  return cameras;
}

interface NetworkFetchOutcome {
  readonly cameras?: readonly CameraRecord[];
  readonly error?: TrafficCameraNetworkError;
}

const CAMERA_FETCHERS: Readonly<
  Record<ImplementedTrafficCameraNetwork, (options: SourceFetchOptions) => Promise<CameraRecord[]>>
> = {
  nyc: fetchNycTrafficCameras,
  tfl: fetchTflTrafficCameras,
  deldot: fetchDelDotTrafficCameras,
  nzta: fetchNztaTrafficCameras,
};

function parseBareRecordArray(
  body: string,
  shapeError: string,
): readonly Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(shapeError);
  }
  if (!Array.isArray(parsed)) throw new Error(shapeError);
  const records = parsed.filter(isRecord);
  if (parsed.length > 0 && records.length === 0) throw new Error(shapeError);
  return records;
}

function cameraRecord(
  record: Record<string, unknown>,
  network: ImplementedTrafficCameraNetwork,
  latitudeKey: string,
  longitudeKey: string,
  imageValue: unknown,
  areaName?: string,
  nameKey = "name",
): CameraRecord | undefined {
  const id = identifier(record["id"]);
  const coordinates = cameraCoordinates(record[latitudeKey], record[longitudeKey]);
  const imageUrl = typeof imageValue === "string" ? safeHttpUrl(imageValue.trim()) : undefined;
  if (id === undefined || coordinates === undefined || imageUrl === undefined) return undefined;

  const name = stringField(record, nameKey)?.trim() || `Camera ${id}`;
  return {
    id,
    network,
    name,
    latitude: coordinates[0],
    longitude: coordinates[1],
    imageUrl,
    ...(areaName?.trim() ? { areaName: areaName.trim() } : {}),
  };
}

function identifier(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function cameraCoordinates(
  latitudeValue: unknown,
  longitudeValue: unknown,
): readonly [number, number] | undefined {
  const latitude = finiteNumber(latitudeValue);
  const longitude = finiteNumber(longitudeValue);
  if (
    latitude === undefined ||
    longitude === undefined ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }
  return [latitude, longitude];
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function absoluteTrafficNzUrl(value: string): string | undefined {
  try {
    return safeHttpUrl(toAbsoluteUrl(value, TRAFFIC_NZ_BASE_URL));
  } catch {
    return undefined;
  }
}
