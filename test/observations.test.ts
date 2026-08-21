import { expect, test } from "bun:test";
import {
  DEEP_STATE_MAP_FRONTLINE_URL,
  SAFECAST_MEASUREMENTS_URL,
  SONDEHUB_TELEMETRY_URL,
  TRAFFIC_CAMERA_NETWORKS,
} from "../src/catalog.js";
import { fetchTrafficCameras, sondeHubSource } from "../src/index.js";
import {
  parseDeepStateMapFrontline,
  parseDelDotTrafficCameras,
  parseNycTrafficCameras,
  parseNztaTrafficCameras,
  parseSafecastMeasurements,
  parseSondeHubTelemetry,
  parseTflTrafficCameras,
} from "../src/parsers.js";
import type { CameraRecord, FrontlineSnapshot } from "../src/index.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

test("SondeHub nested telemetry keeps only the latest frame per serial", async () => {
  const fixture = {
    "RS41-ONE": {
      "2026-08-20T10:00:00Z": {
        serial: "RS41-ONE",
        lat: 50.1,
        lon: 8.6,
        alt: 1_000,
        vel_v: 4,
        frame: 100,
        datetime: "2026-08-20T10:00:00Z",
      },
      "2026-08-20T10:05:00Z": {
        serial: "RS41-ONE",
        lat: 50.2,
        lon: 8.7,
        alt: 1_500,
        vel_v: 5,
        frame: 101,
        datetime: "2026-08-20T10:05:00Z",
      },
    },
    "DFM-TWO": {
      "2026-08-20T09:59:00Z": {
        serial: "DFM-TWO",
        lat: 52.4,
        lon: 13.3,
        alt: 900,
        vel_v: 3,
        frame: 7,
        datetime: "2026-08-20T09:59:00Z",
      },
    },
  };

  const parsed = parseSondeHubTelemetry(JSON.stringify(fixture));
  expect(parsed).toHaveLength(2);
  expect(parsed.find((event) => event.id === "RS41-ONE")).toMatchObject({
    observedAt: "2026-08-20T10:05:00.000Z",
    latitude: 50.2,
    longitude: 8.7,
    magnitude: 1_500,
    magnitudeUnit: "m",
    severity: "unknown",
  });

  const snapshot = await sondeHubSource({
    fetch: async () => jsonResponse(fixture),
  }).fetchSnapshot();
  expect(snapshot?.events).toHaveLength(2);
  expect(snapshot?.requestUrls).toEqual([SONDEHUB_TELEMETRY_URL]);

  const invalidPair = parseSondeHubTelemetry(
    JSON.stringify({
      "PAIR-CHECK": {
        "2026-08-20T10:00:00Z": {
          serial: "PAIR-CHECK",
          lat: 50.1,
          lon: "invalid",
          alt: 1_000,
        },
      },
    }),
  )[0];
  expect(invalidPair?.latitude).toBeUndefined();
  expect(invalidPair?.longitude).toBeUndefined();
});

test("Safecast parses numeric-string coordinates and drops unusable locations", () => {
  const events = parseSafecastMeasurements(
    JSON.stringify([
      {
        id: 101,
        device_id: 55,
        value: 42,
        unit: "cpm",
        latitude: "35.6812",
        longitude: "139.7671",
        captured_at: "2026-08-20T12:00:00Z",
        location_name: "Tokyo",
      },
      {
        id: 102,
        value: 17,
        unit: "cpm",
        latitude: "not-a-coordinate",
        longitude: "139.7",
      },
      {
        id: 103,
        value: 11,
        unit: "cpm",
        latitude: "91",
        longitude: "139.7",
      },
      {
        id: 101,
        value: 99,
        unit: "cpm",
        latitude: "35.7",
        longitude: "139.8",
      },
    ]),
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    id: "101",
    latitude: 35.6812,
    longitude: 139.7671,
    magnitude: 42,
    magnitudeUnit: "cpm",
    severity: "unknown",
    areaName: "Tokyo",
  });
  expect(SAFECAST_MEASUREMENTS_URL).toContain("per_page=100");
});

test("TfL extracts the still image from additionalProperties", () => {
  const cameras = parseTflTrafficCameras(
    JSON.stringify([
      {
        id: "JamCam0001",
        commonName: "JamCam - Westminster Bridge",
        lat: 51.5007,
        lon: -0.1246,
        additionalProperties: [
          { key: "videoUrl", value: "https://example.test/camera.m3u8" },
          { key: "imageUrl", value: "https://example.test/camera.jpg" },
        ],
      },
    ]),
  );

  expect(cameras).toEqual([
    {
      id: "JamCam0001",
      network: "tfl",
      name: "JamCam - Westminster Bridge",
      latitude: 51.5007,
      longitude: -0.1246,
      imageUrl: "https://example.test/camera.jpg",
      areaName: "London, UK",
    },
  ] satisfies CameraRecord[]);
});

test("camera fan-out preserves successful networks when one network throws", async () => {
  const result = await fetchTrafficCameras(["nyc", "tfl"], {
    fetch: async (input) => {
      const url = fetchInputUrl(input);
      if (url.includes("api.tfl.gov.uk")) throw new Error("TfL unavailable");
      return jsonResponse([
        {
          id: "442",
          name: "FDR Drive",
          latitude: 40.71,
          longitude: -74.01,
          imageUrl: "https://example.test/nyc.jpg",
          isOnline: true,
        },
      ]);
    },
  });

  expect(result.cameras).toHaveLength(1);
  expect(result.cameras[0]?.network).toBe("nyc");
  // The transport deliberately genericizes a thrown fetch error and does not
  // carry its cause, so the reason string is not the injected message. What
  // the fan-out must guarantee is isolation: one network fails, the other
  // still returns, and the failure is attributed to the right network with a
  // message naming the endpoint that broke.
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.network).toBe("tfl");
  expect(result.errors[0]?.message).toContain("api.tfl.gov.uk");
});

test("camera parsers cover offline filtering, DelDOT streams, and relative NZ images", () => {
  expect(
    parseNycTrafficCameras(
      JSON.stringify([
        {
          id: "offline",
          name: "Offline camera",
          latitude: 40,
          longitude: -74,
          imageUrl: "https://example.test/offline.jpg",
          isOnline: false,
        },
      ]),
    ),
  ).toEqual([]);

  expect(
    parseDelDotTrafficCameras(
      JSON.stringify({
        videoCameras: [
          {
            id: "KCAM001",
            title: "DE 1 at Milford Neck Road",
            county: "Kent",
            lat: 38.99,
            lon: -75.44,
            enabled: true,
            urls: { m3u8s: "https://video.deldot.gov/KCAM001/playlist.m3u8" },
          },
        ],
      }),
    )[0],
  ).toMatchObject({ id: "KCAM001", network: "deldot", areaName: "Kent" });

  expect(
    parseNztaTrafficCameras(
      JSON.stringify({
        response: {
          camera: [
            {
              id: 714,
              name: "SH1 Tinwald",
              description: "South along Hinds Highway",
              latitude: -43.919632,
              longitude: 171.721055,
              imageUrl: "/camera/714.jpg",
              region: { name: "Canterbury" },
            },
          ],
        },
      }),
    )[0],
  ).toEqual({
    id: "714",
    network: "nzta",
    name: "South along Hinds Highway",
    latitude: -43.919632,
    longitude: 171.721055,
    imageUrl: "https://trafficnz.info/camera/714.jpg",
    areaName: "Canterbury",
  });

  expect(TRAFFIC_CAMERA_NETWORKS.caltrans.implemented).toBe(false);
  expect(TRAFFIC_CAMERA_NETWORKS.ontario511.implemented).toBe(false);
  expect(TRAFFIC_CAMERA_NETWORKS.alberta511.implemented).toBe(false);
});

test("DeepStateMap splits bilingual names and retains no-separator names", () => {
  const coordinates = [
    [
      [37.1, 48.1, 0],
      [37.2, 48.2, 0],
      [37.1, 48.1, 0],
    ],
  ];
  const snapshot: FrontlineSnapshot = parseDeepStateMapFrontline(
    JSON.stringify({
      id: 1234,
      createdAt: "2026-08-20T11:30:00Z",
      map: {
        type: "FeatureCollection",
        features: [
          {
            properties: {
              name: "Окуповано /// Occupied",
              description: "Territorial-control area",
            },
            geometry: { type: "Polygon", coordinates },
          },
          {
            properties: { name: "Untranslated area" },
            geometry: { type: "MultiPolygon", coordinates: [coordinates] },
          },
        ],
      },
    }),
  );

  expect(snapshot.id).toBe(1234);
  expect(snapshot.features[0]).toEqual({
    name: "Окуповано",
    nameEn: "Occupied",
    description: "Territorial-control area",
    geometryType: "Polygon",
    coordinates,
  });
  expect(snapshot.features[1]).toMatchObject({
    name: "Untranslated area",
    geometryType: "MultiPolygon",
  });
  expect(snapshot.features[1]?.nameEn).toBeUndefined();
  expect(DEEP_STATE_MAP_FRONTLINE_URL).toContain("deepstatemap.live");
});

test("observation parsers distinguish empty payloads from malformed shapes", () => {
  expect(parseSafecastMeasurements("[]")).toEqual([]);
  expect(parseSondeHubTelemetry("{}")).toEqual([]);
  expect(parseNycTrafficCameras("[]")).toEqual([]);
  expect(parseTflTrafficCameras("[]")).toEqual([]);
  expect(parseDelDotTrafficCameras(JSON.stringify({ videoCameras: [] }))).toEqual([]);
  expect(parseNztaTrafficCameras(JSON.stringify({ response: { camera: [] } }))).toEqual([]);
  expect(
    parseDeepStateMapFrontline(
      JSON.stringify({
        id: 1234,
        createdAt: "2026-08-20T11:30:00Z",
        map: { type: "FeatureCollection", features: [] },
      }),
    ).features,
  ).toEqual([]);

  expect(() => parseSafecastMeasurements("{}")).toThrow();
  expect(() => parseSondeHubTelemetry("[]")).toThrow();
  expect(() => parseNycTrafficCameras("{}")).toThrow();
  expect(() => parseTflTrafficCameras("{}")).toThrow();
  expect(() => parseDelDotTrafficCameras("{}")).toThrow();
  expect(() => parseNztaTrafficCameras("[]")).toThrow();
  expect(() =>
    parseDeepStateMapFrontline(
      JSON.stringify({
        id: 1234,
        createdAt: "2026-08-20T11:30:00Z",
        map: { type: "FeatureCollection" },
      }),
    ),
  ).toThrow();
});
