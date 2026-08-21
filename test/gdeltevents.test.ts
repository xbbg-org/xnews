import { expect, test } from "bun:test";
import {
  GDELT_EVENT_COLUMNS,
  parseGdeltExportTsv,
  parseGdeltLastUpdate,
} from "../src/sources/gdeltevents.js";

interface RowFixture {
  readonly id?: string;
  readonly eventCode?: string;
  readonly rootCode?: string;
  readonly quadClass?: string;
  readonly goldstein?: string;
  readonly areaName?: string;
  readonly fipsCountry?: string;
  readonly latitude?: string;
  readonly longitude?: string;
  readonly sourceUrl?: string;
}

test("GDELT v2 column map matches the publisher's 61-field export schema", () => {
  expect(GDELT_EVENT_COLUMNS).toMatchObject({
    isRootEvent: 25,
    eventCode: 26,
    eventBaseCode: 27,
    eventRootCode: 28,
    quadClass: 29,
    goldsteinScale: 30,
    numMentions: 31,
    numSources: 32,
    numArticles: 33,
    avgTone: 34,
    actionGeoType: 51,
    actionGeoFullName: 52,
    actionGeoCountryCode: 53,
    actionGeoLatitude: 56,
    actionGeoLongitude: 57,
    dateAdded: 59,
    sourceUrl: 60,
  });
});
function gdeltRow(fixture: RowFixture = {}): string {
  const fields = Array<string>(61).fill("");
  fields[GDELT_EVENT_COLUMNS.globalEventId] = fixture.id ?? "1200000001";
  fields[GDELT_EVENT_COLUMNS.day] = "20260820";
  fields[GDELT_EVENT_COLUMNS.eventCode] = fixture.eventCode ?? "141";
  fields[GDELT_EVENT_COLUMNS.eventBaseCode] = "141";
  fields[GDELT_EVENT_COLUMNS.eventRootCode] = fixture.rootCode ?? "14";
  fields[GDELT_EVENT_COLUMNS.quadClass] = fixture.quadClass ?? "4";
  fields[GDELT_EVENT_COLUMNS.goldsteinScale] = fixture.goldstein ?? "-7.0";
  fields[GDELT_EVENT_COLUMNS.numMentions] = "12";
  fields[GDELT_EVENT_COLUMNS.numSources] = "4";
  fields[GDELT_EVENT_COLUMNS.numArticles] = "7";
  fields[GDELT_EVENT_COLUMNS.avgTone] = "-3.5";
  fields[GDELT_EVENT_COLUMNS.actionGeoFullName] = fixture.areaName ?? "London, England, UK";
  fields[GDELT_EVENT_COLUMNS.actionGeoCountryCode] = fixture.fipsCountry ?? "UK";
  fields[GDELT_EVENT_COLUMNS.actionGeoLatitude] = fixture.latitude ?? "51.5085";
  fields[GDELT_EVENT_COLUMNS.actionGeoLongitude] = fixture.longitude ?? "-0.1257";
  fields[GDELT_EVENT_COLUMNS.sourceUrl] =
    fixture.sourceUrl ?? "https://example.test/report/1200000001";
  return fields.join("\t");
}

test("lastupdate discovery selects the event export and upgrades its legacy HTTP URL", () => {
  const discovery = parseGdeltLastUpdate(`
77125 75f3ae58607195d8cc473bd4de2014a1 http://data.gdeltproject.org/gdeltv2/20260820123000.export.CSV.zip
86153 aeaa4847a5c23e9f3bd97b53eac98247 http://data.gdeltproject.org/gdeltv2/20260820123000.mentions.CSV.zip
4094158 2f98f4c57fe8dce4e57aac269ff7ed76 http://data.gdeltproject.org/gdeltv2/20260820123000.gkg.csv.zip
`);

  expect(discovery).toEqual({
    exportUrl: "https://data.gdeltproject.org/gdeltv2/20260820123000.export.CSV.zip",
    sliceTimestamp: "20260820123000",
  });
});

test("the TSV parser maps the documented event, geography, and source columns", () => {
  const [event] = parseGdeltExportTsv(gdeltRow(), "20260820123000");

  expect(event).toEqual({
    id: "gdelt-1200000001",
    provider: "gdelt-events",
    category: "conflict",
    title: "Protest — London, England, UK",
    severity: "extreme",
    observedAt: "2026-08-20T12:30:00.000Z",
    magnitude: -7,
    magnitudeUnit: "goldstein",
    countryCode: "GB",
    areaName: "London, England, UK",
    eventType: "141",
    url: "https://example.test/report/1200000001",
    latitude: 51.5085,
    longitude: -0.1257,
  });
});

test("FIPS geography codes are converted only through the explicit ISO mapping", () => {
  const events = parseGdeltExportTsv(
    [
      gdeltRow({ id: "1", fipsCountry: "UK" }),
      gdeltRow({ id: "2", fipsCountry: "GM" }),
      gdeltRow({ id: "3", fipsCountry: "ZZ" }),
    ].join("\n"),
    "20260820123000",
  );

  expect(events.map((event) => event.countryCode)).toEqual(["GB", "DE", undefined]);
  expect(events[2]).not.toHaveProperty("countryCode");
});

test("empty geometry stays absent while the 0.0/0.0 null-island artifact is dropped", () => {
  const events = parseGdeltExportTsv(
    [
      gdeltRow({ id: "1", latitude: "", longitude: "" }),
      gdeltRow({ id: "2", latitude: "0.0", longitude: "0.0" }),
    ].join("\n"),
    "20260820123000",
  );

  expect(events.map((event) => event.id)).toEqual(["gdelt-1"]);
  expect(events[0]).not.toHaveProperty("latitude");
  expect(events[0]).not.toHaveProperty("longitude");
});

test("QuadClass and Goldstein severity boundaries preserve the publisher scale", () => {
  const events = parseGdeltExportTsv(
    [
      gdeltRow({ id: "extreme", quadClass: "4", goldstein: "-7" }),
      gdeltRow({ id: "severe", quadClass: "4", goldstein: "-6.9" }),
      gdeltRow({ id: "moderate", quadClass: "3", goldstein: "-10" }),
      gdeltRow({ id: "minor", quadClass: "2", goldstein: "-10" }),
    ].join("\n"),
    "20260820123000",
  );

  expect(events.map((event) => event.severity)).toEqual(["extreme", "severe", "moderate", "minor"]);
});

test("CAMEO roots produce readable titles and provider ids stay stable across slices", () => {
  const row = gdeltRow({
    id: "stable-event",
    eventCode: "203",
    rootCode: "20",
    areaName: "Berlin, Germany",
    fipsCountry: "GM",
  });
  const first = parseGdeltExportTsv(row, "20260820123000")[0];
  const next = parseGdeltExportTsv(row, "20260820124500")[0];

  expect(first?.title).toBe("Use Unconventional Mass Violence — Berlin, Germany");
  expect(first?.id).toBe("gdelt-stable-event");
  expect(next?.id).toBe(first?.id);
  expect(next?.observedAt).toBe("2026-08-20T12:45:00.000Z");
});
