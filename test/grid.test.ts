import { expect, test } from "bun:test";
import {
  caisoFuelMixDataSource,
  caisoPacificDate,
  carbonIntensityDataSource,
  fetchCaisoFuelMix,
  parseCaisoFuelMix,
  parseCarbonIntensity,
} from "../src/index.js";
import { fetchInputUrl } from "./fixtures.js";

const intensityFixture = JSON.stringify({
  data: [
    {
      from: "2026-08-20T12:00Z",
      to: "2026-08-20T12:30Z",
      intensity: { forecast: 146, actual: null, index: "low" },
    },
  ],
});

const generationFixture = JSON.stringify({
  data: {
    from: "2026-08-20T12:00Z",
    to: "2026-08-20T12:30Z",
    generationmix: [
      { fuel: "wind", perc: 31.2 },
      { fuel: "gas", perc: 28.4 },
      { fuel: "nuclear", perc: 15.6 },
    ],
  },
});

const caisoFixture = `Time,Solar,Wind,Geothermal,Biomass,Biogas,Small hydro,Coal,Nuclear,Natural Gas,Large Hydro,Batteries,Imports,Other\r
00:00,-22,4692,795,271,164,268,0,2253,14639,3176,645,4028,0\r
00:05,15,4607,794,271,164,259,0,2252,14669,2778,1381,4044,0\r
00:10,,,,,,,,,,,,,\r
`;

test("GB carbon intensity combines both feeds without relabeling forecast as actual", async () => {
  const rows = parseCarbonIntensity(intensityFixture, generationFixture);
  expect(rows).toEqual([
    {
      from: "2026-08-20T12:00Z",
      to: "2026-08-20T12:30Z",
      intensityForecast: 146,
      intensityIndex: "low",
      mix: { wind: 31.2, gas: 28.4, nuclear: 15.6 },
    },
  ]);
  expect(Object.hasOwn(rows[0] ?? {}, "intensityActual")).toBe(false);

  const requested: string[] = [];
  const release = await carbonIntensityDataSource({
    fetch: async (input) => {
      const url = fetchInputUrl(input);
      requested.push(url);
      return new Response(url.endsWith("/generation") ? generationFixture : intensityFixture);
    },
  }).fetchRelease();
  expect(requested.toSorted()).toEqual([
    "https://api.carbonintensity.org.uk/generation",
    "https://api.carbonintensity.org.uk/intensity",
  ]);
  expect(release?.asOf).toBe("2026-08-20");
  expect(release?.rows[0]?.mix["wind"]).toBe(31.2);
});

test("GB carbon intensity rejects a generation mix from a different interval", () => {
  const mismatched = JSON.stringify({
    data: {
      from: "2026-08-20T12:30Z",
      to: "2026-08-20T13:00Z",
      generationmix: [{ fuel: "wind", perc: 31.2 }],
    },
  });

  expect(() => parseCarbonIntensity(intensityFixture, mismatched)).toThrow(
    "GB carbon intensity and generation intervals do not match",
  );
});

test("CAISO fuel mix keeps reported values and drops an all-blank trailing interval", async () => {
  const rows = parseCaisoFuelMix(caisoFixture);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({
    time: "00:00",
    fuels: {
      Solar: -22,
      Wind: 4692,
      Geothermal: 795,
      Biomass: 271,
      Biogas: 164,
      "Small hydro": 268,
      Coal: 0,
      Nuclear: 2253,
      "Natural Gas": 14639,
      "Large Hydro": 3176,
      Batteries: 645,
      Imports: 4028,
      Other: 0,
    },
  });

  const fetched = await fetchCaisoFuelMix({
    fetch: async () => new Response(caisoFixture),
  });
  expect(fetched).toEqual(rows);
  const release = await caisoFuelMixDataSource({
    now: new Date("2026-01-01T07:30:00Z"),
    fetch: async () => new Response(caisoFixture),
  }).fetchRelease();
  expect(release?.asOf).toBe("2025-12-31");
  expect(caisoPacificDate(new Date("2026-01-01T07:30:00Z"))).toBe("2025-12-31");
});
