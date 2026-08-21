import { expect, test } from "bun:test";
import {
  droughtMonitorDataSource,
  droughtMonitorUrl,
  nasaGistempDataSource,
  noaaCo2DataSource,
  noaaOniDataSource,
  parseDroughtMonitor,
  parseNasaGistemp,
  parseNasaGistempAnnualMeans,
  parseNoaaCo2,
  parseNoaaOni,
} from "../src/index.js";

const oniFixture = `SEAS  YR   TOTAL   ANOM
 DJF 2025  26.10   0.50
 JFM 2025  26.20  -0.50
 FMA 2025  27.01   0.49
`;

const droughtFixture = JSON.stringify([
  {
    MapDate: "20260106",
    None: "31.45",
    D0: "68.55",
    D1: "42.10",
    D2: "19.25",
    D3: "5.20",
    D4: "0.80",
  },
  {
    MapDate: "20260113",
    None: "29.75",
    D0: "70.25",
    D1: "43.20",
    D2: "20.10",
    D3: "5.75",
    D4: "0.95",
  },
]);

const co2Fixture = `# Global daily CO2 trend
# year  month  day smoothed    trend
  2026     1     1   425.12   423.98
  2026     1     2   425.14   424.00
`;

const gistempFixture = `Land-Ocean: Global Means
Year,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,J-D,D-N,DJF,MAM,JJA,SON
2025,.50,.52,.61,.58,.55,.49,.47,.53,.60,.65,.63,.57,.56,.55,.51,.58,.50,.63
2026,.62,***,***,***,***,***,***,***,***,***,***,***,***,.60,.59,***,***,***
`;

test("NOAA ONI parses published thresholds and center-month release dates", async () => {
  const rows = parseNoaaOni(oniFixture);
  expect(rows).toEqual([
    { season: "DJF", year: 2025, total: 26.1, anomaly: 0.5, phase: "el-nino" },
    { season: "JFM", year: 2025, total: 26.2, anomaly: -0.5, phase: "la-nina" },
    { season: "FMA", year: 2025, total: 27.01, anomaly: 0.49, phase: "neutral" },
  ]);

  const release = await noaaOniDataSource({
    fetch: async () => new Response(oniFixture),
  }).fetchRelease();
  expect(release?.asOf).toBe("2025-03-31");
  expect(release?.provider).toBe("noaa-oni");
});

test("US Drought Monitor parses string percentages and uses unpadded API dates", async () => {
  const rows = parseDroughtMonitor(droughtFixture);
  expect(rows[1]).toEqual({
    mapDate: "2026-01-13",
    none: 29.75,
    d0: 70.25,
    d1: 43.2,
    d2: 20.1,
    d3: 5.75,
    d4: 0.95,
  });

  const url = new URL(droughtMonitorUrl({ startDate: "2026-01-02", endDate: "2026-01-13" }));
  expect(url.searchParams.get("startdate")).toBe("1/2/2026");
  expect(url.searchParams.get("enddate")).toBe("1/13/2026");

  // Collected into an array because TypeScript does not narrow a `let`
  // assigned only inside a callback; it would type the read as `null`.
  const acceptHeaders: (string | null)[] = [];
  const release = await droughtMonitorDataSource({
    startDate: "2026-01-02",
    endDate: "2026-01-13",
    fetch: async (_input, init) => {
      acceptHeaders.push(new Headers(init?.headers).get("Accept"));
      return new Response(droughtFixture);
    },
  }).fetchRelease();
  expect(acceptHeaders[0]).toBe("application/json");
  expect(release?.asOf).toBe("2026-01-13");
});

test("US Drought Monitor accepts the live camelCase ISO-datetime representation", () => {
  const rows = parseDroughtMonitor(
    JSON.stringify([
      {
        mapDate: "2026-08-18T00:00:00",
        areaOfInterest: "CONUS",
        none: 23.79,
        d0: 76.21,
        d1: 52.7,
        d2: 29.87,
        d3: 10.6,
        d4: 1.35,
      },
    ]),
  );

  expect(rows).toEqual([
    {
      mapDate: "2026-08-18",
      areaOfInterest: "CONUS",
      none: 23.79,
      d0: 76.21,
      d1: 52.7,
      d2: 29.87,
      d3: 10.6,
      d4: 1.35,
    },
  ]);
});

test("NOAA global CO2 parses daily smoothed and trend ppm", async () => {
  expect(parseNoaaCo2(co2Fixture)).toEqual([
    { date: "2026-01-01", smoothed: 425.12, trend: 423.98 },
    { date: "2026-01-02", smoothed: 425.14, trend: 424 },
  ]);

  const release = await noaaCo2DataSource({
    fetch: async () => new Response(co2Fixture),
  }).fetchRelease();
  expect(release?.asOf).toBe("2026-01-02");
  expect(release?.dataset).toBe("co2-trend-global");
});

test("NASA GISTEMP keeps missing months absent and exposes annual J-D means", async () => {
  const rows = parseNasaGistemp(gistempFixture);
  expect(rows).toHaveLength(24);
  expect(rows.find((row) => row.year === 2026 && row.month === 1)).toEqual({
    year: 2026,
    month: 1,
    anomalyC: 0.62,
  });
  const missingFebruary = rows.find((row) => row.year === 2026 && row.month === 2);
  expect(missingFebruary).toEqual({ year: 2026, month: 2 });
  expect(Object.hasOwn(missingFebruary ?? {}, "anomalyC")).toBe(false);
  expect(parseNasaGistempAnnualMeans(gistempFixture)).toEqual([
    { year: 2025, annualMeanC: 0.56 },
    { year: 2026 },
  ]);

  const release = await nasaGistempDataSource({
    fetch: async () => new Response(gistempFixture),
  }).fetchRelease();
  expect(release?.asOf).toBe("2026-01-31");
});
