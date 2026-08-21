import { expect, test } from "bun:test";
import {
  WORLD_BANK_INDICATORS,
  parseWorldBankIndicator,
  worldBankIndicatorDataSource,
  worldBankIndicatorUrl,
} from "../src/sources/worldbankindicators.js";

const inflationPayload = JSON.stringify([
  { page: 1, pages: 1, per_page: 400, total: 3 },
  [
    {
      indicator: { id: "FP.CPI.TOTL.ZG", value: "Inflation, consumer prices (annual %)" },
      country: { id: "1W", value: "World" },
      countryiso3code: "WLD",
      date: "2023",
      value: 5.8,
      unit: "%",
      obs_status: "",
      decimal: 1,
    },
    {
      indicator: { id: "FP.CPI.TOTL.ZG", value: "Inflation, consumer prices (annual %)" },
      country: { id: "US", value: "United States" },
      countryiso3code: "USA",
      date: "2024",
      value: 2.9,
      unit: "",
      obs_status: "",
      decimal: 1,
    },
    {
      indicator: { id: "FP.CPI.TOTL.ZG", value: "Inflation, consumer prices (annual %)" },
      country: { id: "CA", value: "Canada" },
      countryiso3code: "CAN",
      date: "2025",
      value: null,
      unit: "",
      obs_status: "",
      decimal: 1,
    },
  ],
]);

const inflationUrl =
  "https://api.worldbank.org/v2/country/all/indicator/FP.CPI.TOTL.ZG?format=json&per_page=400&mrnev=1";

test("builds World Bank indicator URLs from an alias or raw code", () => {
  expect(worldBankIndicatorUrl("inflation")).toBe(inflationUrl);
  expect(worldBankIndicatorUrl("SP.POP.TOTL")).toBe(
    "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=400&mrnev=1",
  );
  expect(WORLD_BANK_INDICATORS).toEqual({
    inflation: {
      code: "FP.CPI.TOTL.ZG",
      name: "Inflation, consumer prices",
      unit: "percent",
    },
    unemployment: {
      code: "SL.UEM.TOTL.ZS",
      name: "Unemployment, total",
      unit: "percent of labor force",
    },
    "gdp-growth": {
      code: "NY.GDP.MKTP.KD.ZG",
      name: "GDP growth",
      unit: "percent",
    },
    "extreme-poverty": {
      code: "SI.POV.DDAY",
      name: "Poverty headcount at $2.15/day",
      unit: "percent of population",
    },
  });
});

test("parses the metadata envelope, drops null observations, and identifies aggregates", () => {
  const rows = parseWorldBankIndicator(inflationPayload);

  expect(rows).toEqual([
    {
      indicatorCode: "FP.CPI.TOTL.ZG",
      indicatorName: "Inflation, consumer prices (annual %)",
      countryName: "World",
      countryIso3: "WLD",
      year: "2023",
      value: 5.8,
      unit: "%",
      isAggregate: true,
    },
    {
      indicatorCode: "FP.CPI.TOTL.ZG",
      indicatorName: "Inflation, consumer prices (annual %)",
      countryName: "United States",
      countryIso3: "USA",
      year: "2024",
      value: 2.9,
      isAggregate: false,
    },
  ]);
});

test("rejects the World Bank HTTP-200 error envelope", () => {
  const errorPayload = JSON.stringify([
    {
      message: [
        {
          id: "120",
          key: "Invalid value",
          value: "The provided parameter value is not valid",
        },
      ],
    },
  ]);

  expect(() => parseWorldBankIndicator(errorPayload)).toThrow(
    "unexpected World Bank Indicators response shape",
  );
});

test("publishes the maximum observed year as a year-end data release date", async () => {
  const requestedUrls: string[] = [];
  const source = worldBankIndicatorDataSource({
    indicator: "inflation",
    fetch: async (input) => {
      requestedUrls.push(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      );
      return new Response(inflationPayload);
    },
  });

  const release = await source.fetchRelease();
  expect(source.dataset).toBe("inflation");
  expect(source.requestUrls()).toEqual([inflationUrl]);
  expect(requestedUrls).toEqual([inflationUrl]);
  expect(release).toMatchObject({
    provider: "world-bank-indicators",
    dataset: "inflation",
    asOf: "2024-12-31",
    url: inflationUrl,
  });
  expect(release?.rows).toHaveLength(2);
});
