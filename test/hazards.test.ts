import { expect, test } from "bun:test";
import {
  gdacsSource,
  nhcStormsSource,
  nwsAlertsSource,
  parseGdacs,
  parseNhcStorms,
  parseNwsAlerts,
} from "../src/index.js";

const nwsFixture = JSON.stringify({
  features: [
    {
      id: "https://api.weather.gov/alerts/one",
      properties: {
        event: "Flash Flood Warning",
        headline: "Flash Flood Warning issued for Test County",
        description: "Move to higher ground.",
        severity: "Extreme",
        effective: "2026-08-20T12:00:00Z",
        onset: "2026-08-20T12:15:00Z",
        expires: "2026-08-20T15:00:00Z",
        areaDesc: "Test County",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-101, 39],
            [-99, 39],
            [-99, 41],
            [-101, 41],
            [-101, 39],
          ],
        ],
      },
    },
    {
      id: "https://api.weather.gov/alerts/two",
      properties: {
        event: "Civil Emergency Message",
        headline: "Civil emergency for declared zones",
        description: "Follow instructions from local officials.",
        severity: "Severe",
        effective: "2026-08-20T12:00:00Z",
        expires: "2026-08-20T16:00:00Z",
        areaDesc: "Several declared zones",
      },
      geometry: null,
    },
    {
      id: "https://api.weather.gov/alerts/three",
      properties: {
        event: "Winter Weather Advisory",
        headline: "Moderate winter weather",
        severity: "Moderate",
        areaDesc: "Mountain County",
      },
      geometry: null,
    },
    {
      id: "https://api.weather.gov/alerts/four",
      properties: {
        event: "Wind Advisory",
        headline: "Minor wind event",
        severity: "Minor",
        areaDesc: "Prairie County",
      },
      geometry: null,
    },
    {
      id: "https://api.weather.gov/alerts/five",
      properties: {
        event: "Special Weather Statement",
        headline: "Unranked weather event",
        severity: "Unknown",
        areaDesc: "Coastal County",
      },
      geometry: null,
    },
    {
      id: "https://api.weather.gov/alerts/six",
      properties: {
        event: "Dense Fog Advisory",
        headline: "Alert without upstream severity",
        areaDesc: "Valley County",
      },
      geometry: null,
    },
  ],
});

const nhcFixture = JSON.stringify({
  activeStorms: [
    {
      id: "AL012026",
      binNumber: "1",
      name: "ALICE",
      classification: "HU",
      intensity: "95",
      pressure: "970",
      latitude: "24.5N",
      longitude: "81.2W",
      movementDir: "NW",
      movementSpeed: "10",
      lastUpdate: "2026-08-20T12:00:00Z",
      publicAdvisory: {
        advNum: "12",
        url: "https://www.nhc.noaa.gov/text/MIATCPAT1.shtml",
      },
    },
    {
      id: "SH022026",
      binNumber: "2",
      name: "BIANCA",
      classification: "TS",
      intensity: "55",
      pressure: "995",
      latitude: "12.3S",
      longitude: "45.6E",
      movementDir: "SE",
      movementSpeed: "8",
      lastUpdate: "2026-08-20T11:00:00Z",
      publicAdvisory: {
        advNum: "5",
        url: "https://www.nhc.noaa.gov/text/MIATCPSH2.shtml",
      },
    },
    {
      id: "AL032026",
      name: "CHARLIE",
      classification: "MH",
      intensity: "90",
      latitude: "20.0N",
      longitude: "60.0W",
      lastUpdate: "2026-08-20T10:00:00Z",
    },
  ],
});

const gdacsFixture = JSON.stringify({
  features: [
    {
      properties: {
        eventid: 101,
        eventtype: "EQ",
        alertlevel: "Red",
        eventname: "Earthquake in Testland",
        htmldescription: "<p>Strong earthquake reported.</p>",
        fromdate: "2026-08-20T08:00:00Z",
        todate: "2026-08-21T08:00:00Z",
        country: "Testland",
        iso3: "TST",
        severitydata: { severity: 6.7, severitytext: "Magnitude 6.7" },
        url: { report: "https://www.gdacs.org/report.aspx?eventid=101&episodeid=1" },
      },
      geometry: { type: "Point", coordinates: [37.25, 12.5] },
    },
    {
      properties: {
        eventid: 101,
        eventtype: "TC",
        alertlevel: "Green",
        eventname: "Tropical cyclone in Exampleland",
        htmldescription: "<p>Low alert level.</p>",
        fromdate: "2026-08-19T08:00:00Z",
        todate: "2026-08-22T08:00:00Z",
        country: "Exampleland",
        iso3: "EXP",
        severitydata: { severity: 40, severitytext: "Maximum wind speed 40 kt" },
        url: { report: "https://www.gdacs.org/report.aspx?eventid=101&episodeid=2" },
      },
      geometry: { type: "Point", coordinates: [10, 20] },
    },
  ],
});

test("parses NWS severity, categories, and optional GeoJSON geometry", () => {
  const events = parseNwsAlerts(nwsFixture);
  expect(events.map((event) => event.severity)).toEqual([
    "extreme",
    "severe",
    "moderate",
    "minor",
    "unknown",
    "unknown",
  ]);
  expect(events[0]?.category).toBe("flood");
  expect(events[0]?.latitude).toBeCloseTo(40);
  expect(events[0]?.longitude).toBeCloseTo(-100);
  expect(events[1]?.category).toBe("hazard");
  expect("latitude" in events[1]!).toBe(false);
  expect("longitude" in events[1]!).toBe(false);
  expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
});

test("area-weights NWS MultiPolygon centroids", () => {
  const events = parseNwsAlerts(
    JSON.stringify({
      features: [
        {
          id: "multi-polygon-alert",
          properties: {
            event: "Flood Warning",
            headline: "Flood warning for two areas",
            severity: "Moderate",
          },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [-101, 39],
                  [-99, 39],
                  [-99, 41],
                  [-101, 41],
                  [-101, 39],
                ],
              ],
              [
                [
                  [-91, 29],
                  [-89, 29],
                  [-89, 31],
                  [-91, 31],
                  [-91, 29],
                ],
              ],
            ],
          },
        },
      ],
    }),
  );
  expect(events[0]?.longitude).toBeCloseTo(-95);
  expect(events[0]?.latitude).toBeCloseTo(35);
});

test("parses NHC hemisphere coordinates and wind severity", () => {
  const events = parseNhcStorms(nhcFixture);
  expect(events[0]).toMatchObject({
    id: "AL012026",
    latitude: 24.5,
    longitude: -81.2,
    magnitude: 95,
    magnitudeUnit: "kt",
    severity: "severe",
  });
  expect(events[1]).toMatchObject({
    latitude: -12.3,
    longitude: 45.6,
    severity: "moderate",
  });
  expect(events[2]?.severity).toBe("extreme");
  expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
});

test("omits schema-invalid NHC intensity strings instead of coercing them", () => {
  const events = parseNhcStorms(
    JSON.stringify({
      activeStorms: [
        {
          id: "AL042026",
          name: "DELTA",
          classification: "XX",
          intensity: "0x60",
          latitude: "18.0N",
          longitude: "55.0W",
        },
      ],
    }),
  );
  expect(events[0]?.severity).toBe("unknown");
  expect("magnitude" in events[0]!).toBe(false);
});

test("keeps GDACS GeoJSON longitude-latitude order and type-scoped ids", () => {
  const events = parseGdacs(gdacsFixture);
  expect(events[0]).toMatchObject({
    id: "gdacs-EQ-101",
    category: "seismic",
    severity: "extreme",
    longitude: 37.25,
    latitude: 12.5,
    areaName: "Testland",
  });
  expect(events[0]?.countryCode).toBeUndefined();
  expect(events[1]?.id).toBe("gdacs-TC-101");
  expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
});

test("event source snapshots use injected transport and lane filters", async () => {
  // Collected into an array because TypeScript does not narrow a `let`
  // assigned only inside a callback; it would type the read as `null`.
  const nwsUserAgents: (string | null)[] = [];
  const nwsSnapshot = await nwsAlertsSource({
    minSeverity: "extreme",
    fetch: async (_input, init) => {
      nwsUserAgents.push(new Headers(init?.headers).get("user-agent"));
      return new Response(nwsFixture);
    },
  }).fetchSnapshot();
  if (!nwsSnapshot) throw new Error("expected an NWS snapshot");
  expect(nwsSnapshot.events.map((event) => event.id)).toEqual([
    "https://api.weather.gov/alerts/one",
  ]);
  expect(nwsUserAgents[0]).toContain("xnews weather alerts");

  const nhcSnapshot = await nhcStormsSource({
    fetch: async () => new Response(nhcFixture),
  }).fetchSnapshot();
  if (!nhcSnapshot) throw new Error("expected an NHC snapshot");
  expect(new Set(nhcSnapshot.events.map((event) => event.id)).size).toBe(nhcSnapshot.events.length);

  const gdacsSnapshot = await gdacsSource({
    fetch: async () => new Response(gdacsFixture),
  }).fetchSnapshot();
  if (!gdacsSnapshot) throw new Error("expected a GDACS snapshot");
  expect(new Set(gdacsSnapshot.events.map((event) => event.id)).size).toBe(
    gdacsSnapshot.events.length,
  );
});
