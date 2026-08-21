import { expect, test } from "bun:test";
import {
  GLOFAS_BASINS,
  GLOFAS_XNEWS_EXTREME_RATIO,
  GLOFAS_XNEWS_MODERATE_RATIO,
  GLOFAS_XNEWS_SEVERE_RATIO,
  fetchGlofasFloodEvents,
  glofasSeverityForRatio,
  parseGlofasFloodEvents,
} from "../src/sources/glofasflood.js";
import {
  NOAA_TSUNAMI_PAAQ_ATOM_URL,
  NOAA_TSUNAMI_PHEB_ATOM_URL,
  fetchNoaaTsunamiEvents,
  parseNoaaTsunamiEvents,
} from "../src/sources/noaatsunami.js";
import {
  USGS_ELEVATED_VOLCANOES_URL,
  gvpVolcanoCoordinatesUrl,
  parseUsgsVolcanoEvents,
  usgsVolcanoesSource,
} from "../src/sources/usgsvolcanoes.js";
import { fetchInputUrl } from "./fixtures.js";

const VOLCANO_ALERTS = JSON.stringify([
  {
    volcano_name: "Great Sitkin",
    vnum: "311120",
    alert_level: "WATCH",
    color_code: "ORANGE",
    obs_abbr: "avo",
    obs_fullname: "Alaska Volcano Observatory",
    sent_utc: "2026-08-20 19:58:51",
  },
  {
    volcano_name: "Kilauea",
    vnum: "332010",
    alert_level: "ADVISORY",
    color_code: "YELLOW",
    obs_abbr: "hvo",
    obs_fullname: "Hawaiian Volcano Observatory",
    sent_utc: "2026-08-20 19:06:40",
  },
]);

const ONE_VOLCANO_COORDINATE = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-176.13, 52.076] },
      properties: { Volcano_Number: 311120 },
    },
  ],
});

function jsonResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "application/json" } });
}

test("GVP coordinate URL admits only escaped numeric volcano identifiers", () => {
  const url = gvpVolcanoCoordinatesUrl(["311120", "332010", "311120", "1) OR INCLUDE_ALL"]);
  expect(url).toBeDefined();
  expect(new URL(url ?? "").searchParams.get("CQL_FILTER")).toBe(
    "Volcano_Number IN (311120,332010)",
  );
});

test("USGS alert severity does not inherit the separate aviation color scale", () => {
  const [event] = parseUsgsVolcanoEvents(
    JSON.stringify([
      {
        volcano_name: "Scale Test",
        volcano_number: "999999",
        alert_level: "NORMAL",
        color_code: "RED",
      },
    ]),
  );
  expect(event?.severity).toBe("minor");
  expect(event?.eventType).toContain("RED aviation color code");
});

test("USGS duplicate alert rows retain one stable volcano id", () => {
  const duplicateAlerts = JSON.stringify([
    {
      volcano_name: "Duplicate Volcano",
      volcano_number: "123456",
      alert_level: "WATCH",
      color_code: "ORANGE",
    },
    {
      volcano_name: "Duplicate Volcano",
      volcano_number: "123456",
      alert_level: "WATCH",
      color_code: "ORANGE",
    },
  ]);
  const events = parseUsgsVolcanoEvents(duplicateAlerts);
  expect(events.map((event) => event.id)).toEqual(["usgs-volcanoes-123456"]);
});

test("USGS volcanoes retain alerts that have no Smithsonian coordinate match", () => {
  const events = parseUsgsVolcanoEvents(VOLCANO_ALERTS, ONE_VOLCANO_COORDINATE);
  expect(events).toHaveLength(2);

  const matched = events.find((event) => event.areaName === "Great Sitkin");
  expect(matched?.latitude).toBe(52.076);
  expect(matched?.longitude).toBe(-176.13);
  expect(matched?.severity).toBe("severe");
  expect(matched?.eventType).toContain("ORANGE aviation color code");

  const unmatched = events.find((event) => event.areaName === "Kilauea");
  expect(unmatched).toBeDefined();
  expect(unmatched?.latitude).toBeUndefined();
  expect(unmatched?.longitude).toBeUndefined();
});

test("USGS volcano coordinate failure degrades to a snapshot warning", async () => {
  const snapshot = await usgsVolcanoesSource().fetchSnapshot({
    fetch: async (input) => {
      const url = fetchInputUrl(input);
      if (url === USGS_ELEVATED_VOLCANOES_URL) return jsonResponse(VOLCANO_ALERTS);
      throw new Error("GVP unavailable");
    },
  });

  expect(snapshot?.events).toHaveLength(2);
  expect(snapshot?.events.every((event) => event.latitude === undefined)).toBe(true);
  expect(snapshot?.warnings).toHaveLength(1);
  expect(snapshot?.warnings[0]).toContain("coordinate enrichment failed");
  expect(snapshot?.requestUrls).toHaveLength(2);
});

test("USGS malformed GVP features also degrade to an enrichment warning", async () => {
  const malformedGvp = JSON.stringify({
    features: [{ properties: { renamed_volcano_number: 311120 }, geometry: {} }],
  });
  const snapshot = await usgsVolcanoesSource().fetchSnapshot({
    fetch: async (input) =>
      fetchInputUrl(input) === USGS_ELEVATED_VOLCANOES_URL
        ? jsonResponse(VOLCANO_ALERTS)
        : jsonResponse(malformedGvp),
  });
  expect(snapshot?.events).toHaveLength(2);
  expect(snapshot?.warnings[0]).toContain("unexpected Smithsonian GVP WFS response shape");
});

function atomFeed(entries: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>NOAA Tsunami Messages</title>
      ${entries.join("\n")}
    </feed>`;
}

const DUPLICATE_WARNING_ENTRY = `
  <entry>
    <id>urn:uuid:shared-warning</id>
    <title>Tsunami Warning for the Aleutian Islands</title>
    <updated>2026-08-20T18:16:14Z</updated>
    <summary>Dangerous waves are possible.</summary>
    <link rel="alternate" href="https://www.tsunami.gov/events/shared-warning.txt" />
  </entry>`;
const INFORMATION_ENTRY = `
  <entry>
    <id>urn:uuid:information</id>
    <title>Tsunami Information Statement for central Peru</title>
    <updated>2026-08-20T19:00:00Z</updated>
    <summary>No tsunami danger is expected.</summary>
    <link rel="alternate" href="https://www.tsunami.gov/events/information.txt" />
  </entry>`;

test("NOAA tsunami merge dedupes identical derived Atom ids across both centers", () => {
  const events = parseNoaaTsunamiEvents([
    atomFeed([DUPLICATE_WARNING_ENTRY]),
    atomFeed([DUPLICATE_WARNING_ENTRY, INFORMATION_ENTRY]),
  ]);

  expect(events).toHaveLength(2);
  expect(new Set(events.map((event) => event.id)).size).toBe(2);
  expect(events.find((event) => event.title.includes("Warning"))?.severity).toBe("extreme");
  expect(events.find((event) => event.title.includes("Information"))?.severity).toBe("minor");
});

test("NOAA tsunami fetch reads and merges both warning-center feeds", async () => {
  const requested = new Set<string>();
  const events = await fetchNoaaTsunamiEvents({
    fetch: async (input) => {
      const url = fetchInputUrl(input);
      requested.add(url);
      if (url === NOAA_TSUNAMI_PAAQ_ATOM_URL) {
        return new Response(atomFeed([DUPLICATE_WARNING_ENTRY]));
      }
      if (url === NOAA_TSUNAMI_PHEB_ATOM_URL) {
        return new Response(atomFeed([INFORMATION_ENTRY]));
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  expect(requested).toEqual(new Set([NOAA_TSUNAMI_PAAQ_ATOM_URL, NOAA_TSUNAMI_PHEB_ATOM_URL]));
  expect(events).toHaveLength(2);
});

function floodPoint(past: readonly number[], forecast: readonly number[]): Record<string, unknown> {
  const pastDays = past.map((_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`);
  const forecastDays = forecast.map((_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
  return {
    latitude: 0,
    longitude: 0,
    daily: {
      time: [...pastDays, ...forecastDays],
      river_discharge: [...past, ...forecast],
    },
  };
}

test("GloFAS parser handles array and bare-object response forms", async () => {
  const basins = GLOFAS_BASINS.slice(0, 2);
  const arrayEvents = parseGlofasFloodEvents(
    JSON.stringify([floodPoint([100, 100], [149, 150]), floodPoint([20, 20], [40, 60])]),
    basins,
    "2026-08-01",
  );
  expect(arrayEvents).toHaveLength(2);
  expect(arrayEvents[0]?.id).toBe("glofas-amazon");
  expect(arrayEvents[0]?.magnitude).toBe(150);
  expect(arrayEvents[0]?.severity).toBe("moderate");
  expect(arrayEvents[1]?.severity).toBe("extreme");

  const now = Date.now();
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
  const barePoint = {
    daily: {
      time: [yesterday, today, tomorrow],
      river_discharge: [100, 100, 200],
    },
  };
  let requestCount = 0;
  const bareEvents = await fetchGlofasFloodEvents({
    basins: [GLOFAS_BASINS[0]],
    fetch: async () => {
      requestCount += 1;
      return jsonResponse(JSON.stringify(barePoint));
    },
  });
  expect(bareEvents).toHaveLength(1);
  expect(bareEvents[0]?.id).toBe("glofas-amazon");
  expect(bareEvents[0]?.severity).toBe("severe");
  expect(requestCount).toBe(1);

  let batchRequestUrl = "";
  let batchRequestCount = 0;
  const batchEvents = await fetchGlofasFloodEvents({
    basins,
    fetch: async (input) => {
      batchRequestCount += 1;
      batchRequestUrl = fetchInputUrl(input);
      return jsonResponse(JSON.stringify([barePoint, barePoint]));
    },
  });
  expect(batchRequestCount).toBe(1);
  expect(batchEvents).toHaveLength(2);
  expect(new URL(batchRequestUrl).searchParams.get("latitude")?.split(",")).toHaveLength(2);
  expect(() => parseGlofasFloodEvents(JSON.stringify(barePoint), basins, today)).toThrow(
    "unexpected Open-Meteo GloFAS flood response shape",
  );
});

test("GloFAS rejects basin names that would collide as event ids", () => {
  const collisionBasins = [
    { ...GLOFAS_BASINS[0], name: "Same Basin" },
    { ...GLOFAS_BASINS[1], name: "same-basin" },
  ];
  const body = JSON.stringify([floodPoint([100, 100], [200]), floodPoint([100, 100], [200])]);
  expect(() => parseGlofasFloodEvents(body, collisionBasins, "2026-08-01")).toThrow(
    "unique event ids",
  );
});

test("xnews GloFAS heuristic uses inclusive documented threshold boundaries", () => {
  expect(glofasSeverityForRatio(GLOFAS_XNEWS_MODERATE_RATIO - 0.001)).toBe("minor");
  expect(glofasSeverityForRatio(GLOFAS_XNEWS_MODERATE_RATIO)).toBe("moderate");
  expect(glofasSeverityForRatio(GLOFAS_XNEWS_SEVERE_RATIO - 0.001)).toBe("moderate");
  expect(glofasSeverityForRatio(GLOFAS_XNEWS_SEVERE_RATIO)).toBe("severe");
  expect(glofasSeverityForRatio(GLOFAS_XNEWS_EXTREME_RATIO - 0.001)).toBe("severe");
  expect(glofasSeverityForRatio(GLOFAS_XNEWS_EXTREME_RATIO)).toBe("extreme");
  expect(glofasSeverityForRatio(Number.NaN)).toBe("unknown");
});
