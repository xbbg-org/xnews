import { expect, test } from "bun:test";
import { cisaKevDataSource, parseCisaKev } from "../src/sources/cisakev.js";
import { faaStatusSource, parseFaaStatus } from "../src/sources/faastatus.js";
import { iodaDataSource } from "../src/sources/ioda.js";
import { ooniDataSource, parseOoniCensorship } from "../src/sources/ooni.js";

const cisaKevPayload = JSON.stringify({
  title: "CISA Known Exploited Vulnerabilities Catalog",
  catalogVersion: "2026.08.20",
  dateReleased: "2026-08-20T23:30:00-04:00",
  count: 2,
  vulnerabilities: [
    {
      cveID: "CVE-2026-1001",
      vendorProject: "Example Corp",
      product: "Gateway",
      vulnerabilityName: "Example Gateway Command Injection",
      dateAdded: "2026-08-20",
      shortDescription: "An unauthenticated attacker can execute commands.",
      requiredAction: "Apply the vendor update.",
      dueDate: "2026-09-10",
      knownRansomwareCampaignUse: "Known",
      notes: "See vendor advisory.",
      cwes: ["CWE-78"],
    },
    {
      cveID: "CVE-2026-1002",
      vendorProject: "Example Systems",
      product: "Console",
      vulnerabilityName: "Example Console Authentication Bypass",
      dateAdded: "2026-08-20",
      shortDescription: "A crafted request bypasses authentication.",
      requiredAction: "Restrict access and upgrade.",
      dueDate: "2026-09-10",
      knownRansomwareCampaignUse: "Unknown",
      notes: "",
      cwes: ["CWE-288"],
    },
  ],
});

const faaStatusXml = `<?xml version="1.0" encoding="UTF-8"?>
<AIRPORT_STATUS_INFORMATION>
  <Delay_type>
    <Name>Ground Delays</Name>
    <Ground_Delay>
      <ARPT>SFO</ARPT>
      <Reason>Low ceilings &amp; visibility</Reason>
      <Avg>45 minutes</Avg>
    </Ground_Delay>
  </Delay_type>
  <Delay_type>
    <Name>Ground Stops</Name>
    <Ground_Stop>
      <ARPT>JFK</ARPT>
      <Reason>Thunderstorms</Reason>
    </Ground_Stop>
  </Delay_type>
  <Delay_type>
    <Name>Arrival and Departure Delays</Name>
    <Arrival_Departure_Delay>
      <ARPT>ORD</ARPT>
      <Reason>Volume</Reason>
      <Avg>20 minutes</Avg>
    </Arrival_Departure_Delay>
  </Delay_type>
  <Delay_type>
    <Name>Airport Closures</Name>
    <Airport_Closure>
      <ARPT>ASE</ARPT>
      <Reason>Snow removal</Reason>
    </Airport_Closure>
  </Delay_type>
</AIRPORT_STATUS_INFORMATION>`;

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("parses CISA KEV ransomware status and normalizes the release instant", async () => {
  const rows = parseCisaKev(cisaKevPayload);
  expect(rows.map((row) => row.knownRansomwareUse)).toEqual([true, false]);
  expect(rows[0]?.nvdUrl).toBe("https://nvd.nist.gov/vuln/detail/CVE-2026-1001");

  const source = cisaKevDataSource({
    fetch: async () => new Response(cisaKevPayload),
  });
  const release = await source.fetchRelease({ ifNewerThan: "2026-08-20" });
  expect(release?.asOf).toBe("2026-08-21");
  expect(release?.rows).toHaveLength(2);
});

test("maps FAA status sections to stable aviation events without fabricated coordinates", async () => {
  const first = parseFaaStatus(faaStatusXml);
  const second = parseFaaStatus(faaStatusXml);
  expect(first.map((event) => event.id)).toEqual(second.map((event) => event.id));
  expect(Object.fromEntries(first.map((event) => [event.areaName, event.severity]))).toEqual({
    ASE: "extreme",
    JFK: "severe",
    SFO: "moderate",
    ORD: "minor",
  });
  expect(first.every((event) => !("latitude" in event) && !("longitude" in event))).toBe(true);
  expect(first.every((event) => event.category === "aviation" && event.countryCode === "US")).toBe(
    true,
  );

  const snapshot = await faaStatusSource({
    fetch: async () => new Response(faaStatusXml),
  }).fetchSnapshot({ minSeverity: "severe" });
  expect(snapshot?.events.map((event) => event.severity)).toEqual(["extreme", "severe"]);
});

test("converts IODA date windows to UNIX-second query parameters", async () => {
  let requestedUrl = "";
  const source = iodaDataSource({
    fetch: async (input) => {
      requestedUrl = fetchInputUrl(input);
      return new Response(
        JSON.stringify({
          data: [
            {
              entity: { code: "us", name: "United States", type: "country" },
              scores: { overall: 87.5 },
              overall_score: 87.5,
            },
          ],
        }),
      );
    },
  });
  const since = "2026-08-19T12:34:56.789Z";
  const until = "2026-08-20T13:35:57.999Z";
  const release = await source.fetchRelease({ since, until });
  const url = new URL(requestedUrl);
  expect(url.searchParams.get("from")).toBe(String(Math.floor(Date.parse(since) / 1_000)));
  expect(url.searchParams.get("until")).toBe(String(Math.floor(Date.parse(until) / 1_000)));
  expect(url.searchParams.get("limit")).toBe("20");
  expect(release?.asOf).toBe("2026-08-20");
  expect(release?.rows[0]).toEqual({
    countryCode: "US",
    countryName: "United States",
    overallScore: 87.5,
  });
});

test("omits OONI anomalyRate when measurement_count is zero", async () => {
  const payload = JSON.stringify({
    result: [
      {
        probe_cc: "ir",
        anomaly_count: 3,
        confirmed_count: 1,
        failure_count: 2,
        measurement_count: 0,
        ok_count: 0,
      },
      {
        probe_cc: "ua",
        anomaly_count: 10,
        confirmed_count: 2,
        failure_count: 5,
        measurement_count: 40,
        ok_count: 25,
      },
    ],
  });
  const rows = parseOoniCensorship(payload);
  expect(rows[0]).toMatchObject({ probeCountryCode: "IR", measurementCount: 0 });
  expect("anomalyRate" in (rows[0] ?? {})).toBe(false);
  expect(rows[1]?.anomalyRate).toBe(0.25);

  let requestedUrl = "";
  const release = await ooniDataSource({
    fetch: async (input) => {
      requestedUrl = fetchInputUrl(input);
      return new Response(payload);
    },
  }).fetchRelease({ since: "2026-08-06" });
  expect(new URL(requestedUrl).searchParams.get("since")).toBe("2026-08-06");
  expect(release?.asOf).toBe("2026-08-06");
});
