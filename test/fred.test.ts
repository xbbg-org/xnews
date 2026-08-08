import { expect, test } from "bun:test";
import { fetchDataRelease } from "../src/data.js";
import { XnewsFetchError } from "../src/http.js";
import {
  fredDataSource,
  fetchFredObservations,
  fetchFredSeries,
  fredSeriesObservationsUrl,
  fredSeriesSearchUrl,
  fredSeriesUrl,
  parseFredObservations,
  parseFredSeries,
  parseFredSeriesSearch,
  searchFredSeries,
} from "../src/sources/fred.js";

const gdpSeries = {
  id: "GDP",
  realtime_start: "2026-08-01",
  realtime_end: "2026-08-01",
  title: "Gross Domestic Product",
  observation_start: "1947-01-01",
  observation_end: "2026-04-01",
  frequency: "Quarterly",
  frequency_short: "Q",
  units: "Billions of Dollars",
  units_short: "Bil. of $",
  seasonal_adjustment: "Seasonally Adjusted Annual Rate",
  seasonal_adjustment_short: "SAAR",
  last_updated: "2026-07-30 07:45:02-05",
  popularity: 93,
  group_popularity: 91,
  notes: "BEA national accounts.",
};

const searchPayload = JSON.stringify({
  realtime_start: "2026-08-01",
  realtime_end: "2026-08-01",
  order_by: "popularity",
  sort_order: "desc",
  count: 25,
  offset: 4,
  limit: 2,
  seriess: [{ title: "missing id" }, gdpSeries],
});

const observationsPayload = JSON.stringify({
  realtime_start: "2026-08-01",
  realtime_end: "2026-08-01",
  observation_start: "2025-01-01",
  observation_end: "2026-01-01",
  units: "pch",
  output_type: 1,
  order_by: "observation_date",
  sort_order: "asc",
  count: 4,
  offset: 0,
  limit: 100,
  observations: [
    {
      realtime_start: "2026-08-01",
      realtime_end: "2026-08-01",
      date: "2025-01-01",
      value: "2.50",
    },
    {
      realtime_start: "2026-08-01",
      realtime_end: "2026-08-01",
      date: "2025-04-01",
      value: ".",
    },
    {
      realtime_start: "2026-08-01",
      realtime_end: "2026-08-01",
      date: "not-a-date",
      value: "7",
    },
    {
      realtime_start: "2026-08-01",
      realtime_end: "2026-08-01",
      date: "2025-10-01",
      value: "not-a-number",
    },
  ],
});

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("builds encoded FRED V1 URLs with explicit options", () => {
  const searchHref = fredSeriesSearchUrl("GDP & inflation/deflator", {
    apiKey: "key+with/value",
    searchType: "series_id",
    realtimeStart: "2020-01-01",
    realtimeEnd: "2026-08-01",
    limit: 0,
    offset: 12,
    orderBy: "series_id",
    sortOrder: "asc",
    filterVariable: "units",
    filterValue: "Index 2017=100 & ratio",
    tagNames: ["united states", "gdp"],
    excludeTagNames: "discontinued;monthly",
  });
  expect(searchHref).toContain("search_text=GDP+%26+inflation%2Fdeflator");
  const search = new URL(searchHref);
  expect(search.pathname).toBe("/fred/series/search");
  expect(Object.fromEntries(search.searchParams)).toMatchObject({
    api_key: "key+with/value",
    file_type: "json",
    search_text: "GDP & inflation/deflator",
    search_type: "series_id",
    realtime_start: "2020-01-01",
    realtime_end: "2026-08-01",
    limit: "0",
    offset: "12",
    order_by: "series_id",
    sort_order: "asc",
    filter_variable: "units",
    filter_value: "Index 2017=100 & ratio",
    tag_names: "united states;gdp",
    exclude_tag_names: "discontinued;monthly",
  });

  const series = new URL(
    fredSeriesUrl("GDP & PCE", {
      apiKey: "test-key",
      realtimeStart: "2025-01-01",
      realtimeEnd: "2025-12-31",
    }),
  );
  expect(series.pathname).toBe("/fred/series");
  expect(series.searchParams.get("series_id")).toBe("GDP & PCE");
  expect(series.searchParams.get("realtime_start")).toBe("2025-01-01");
  expect(series.searchParams.get("realtime_end")).toBe("2025-12-31");

  const observations = new URL(
    fredSeriesObservationsUrl("GDP", {
      apiKey: "test-key",
      realtimeStart: "2024-01-01",
      realtimeEnd: "2026-01-01",
      observationStart: "2000-01-01",
      observationEnd: "2025-12-31",
      units: "pch",
      frequency: "q",
      aggregationMethod: "eop",
      vintageDates: ["2025-01-15", "2026-01-15"],
      limit: 0,
      offset: 3,
      sortOrder: "desc",
    }),
  );
  expect(Object.fromEntries(observations.searchParams)).toMatchObject({
    series_id: "GDP",
    observation_start: "2000-01-01",
    observation_end: "2025-12-31",
    units: "pch",
    frequency: "q",
    aggregation_method: "eop",
    vintage_dates: "2025-01-15,2026-01-15",
    limit: "0",
    offset: "3",
    sort_order: "desc",
  });
});

test("rejects invalid FRED Date options and empty vintage date collections", () => {
  const invalidDate = new Date(Number.NaN);
  const secret = "date-options-secret";
  const builders: readonly (() => string)[] = [
    () => fredSeriesSearchUrl("GDP", { apiKey: secret, realtimeStart: invalidDate }),
    () => fredSeriesSearchUrl("GDP", { apiKey: secret, realtimeEnd: invalidDate }),
    () => fredSeriesUrl("GDP", { apiKey: secret, realtimeStart: invalidDate }),
    () => fredSeriesUrl("GDP", { apiKey: secret, realtimeEnd: invalidDate }),
    () => fredSeriesObservationsUrl("GDP", { apiKey: secret, realtimeStart: invalidDate }),
    () => fredSeriesObservationsUrl("GDP", { apiKey: secret, realtimeEnd: invalidDate }),
    () => fredSeriesObservationsUrl("GDP", { apiKey: secret, observationStart: invalidDate }),
    () => fredSeriesObservationsUrl("GDP", { apiKey: secret, observationEnd: invalidDate }),
    () => fredSeriesObservationsUrl("GDP", { apiKey: secret, vintageDates: [invalidDate] }),
    () => fredSeriesObservationsUrl("GDP", { apiKey: secret, vintageDates: [] }),
  ];

  for (const build of builders) {
    let caught: unknown;
    try {
      build();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(XnewsFetchError);
    if (!(caught instanceof XnewsFetchError)) {
      throw new Error("expected invalid FRED options to throw XnewsFetchError", { cause: caught });
    }
    expect(caught).toMatchObject({ code: "config" });
    expect(caught.url).not.toContain(secret);
  }
});

test("parses search results, skips malformed series, and preserves page metadata", () => {
  const page = parseFredSeriesSearch(searchPayload);
  expect(page).toMatchObject({
    realtimeStart: "2026-08-01",
    realtimeEnd: "2026-08-01",
    orderBy: "popularity",
    sortOrder: "desc",
    count: 25,
    offset: 4,
    limit: 2,
  });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toEqual({
    id: "GDP",
    realtimeStart: "2026-08-01",
    realtimeEnd: "2026-08-01",
    title: "Gross Domestic Product",
    observationStart: "1947-01-01",
    observationEnd: "2026-04-01",
    frequency: "Quarterly",
    frequencyShort: "Q",
    units: "Billions of Dollars",
    unitsShort: "Bil. of $",
    seasonalAdjustment: "Seasonally Adjusted Annual Rate",
    seasonalAdjustmentShort: "SAAR",
    lastUpdated: "2026-07-30 07:45:02-05",
    popularity: 93,
    groupPopularity: 91,
    notes: "BEA national accounts.",
  });
});

test("returns the first valid series metadata record", () => {
  const series = parseFredSeries(
    JSON.stringify({ seriess: [{ ...gdpSeries, popularity: "93" }, gdpSeries] }),
  );
  expect(series?.id).toBe("GDP");
  expect(parseFredSeries(JSON.stringify({ seriess: [] }))).toBeUndefined();
});

test("parses numeric and missing observations while retaining raw values and page metadata", () => {
  const page = parseFredObservations(observationsPayload);
  expect(page).toMatchObject({
    realtimeStart: "2026-08-01",
    realtimeEnd: "2026-08-01",
    observationStart: "2025-01-01",
    observationEnd: "2026-01-01",
    units: "pch",
    outputType: 1,
    orderBy: "observation_date",
    sortOrder: "asc",
    count: 4,
    offset: 0,
    limit: 100,
  });
  expect(page.items).toEqual([
    {
      realtimeStart: "2026-08-01",
      realtimeEnd: "2026-08-01",
      date: "2025-01-01",
      value: 2.5,
      rawValue: "2.50",
    },
    {
      realtimeStart: "2026-08-01",
      realtimeEnd: "2026-08-01",
      date: "2025-04-01",
      value: null,
      rawValue: ".",
    },
  ]);
});

test("distinguishes empty FRED arrays from invalid endpoint schemas", () => {
  expect(parseFredSeriesSearch(JSON.stringify({ seriess: [] }))).toEqual({ items: [] });
  expect(parseFredObservations(JSON.stringify({ observations: [] }))).toEqual({ items: [] });

  expect(() => parseFredSeriesSearch(JSON.stringify({ observations: [] }))).toThrow(
    "unexpected FRED series search response shape",
  );
  expect(() => parseFredSeries(JSON.stringify({ seriess: {} }))).toThrow(
    "unexpected FRED series response shape",
  );
  expect(() => parseFredObservations(JSON.stringify({ observations: null }))).toThrow(
    "unexpected FRED observations response shape",
  );
  expect(() => parseFredSeriesSearch(JSON.stringify({ seriess: [{ id: 5 }] }))).toThrow(
    "FRED series search response contained no valid records",
  );
  expect(() => parseFredSeries(JSON.stringify({ seriess: [{ id: 5 }] }))).toThrow(
    "FRED series response contained no valid records",
  );
  expect(() =>
    parseFredObservations(JSON.stringify({ observations: [{ date: "2026-01-01" }] })),
  ).toThrow("FRED observations response contained no valid records");
});

test("fetch wrappers use the injected transport", async () => {
  const fetchedUrls: string[] = [];
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const href = fetchInputUrl(input);
    fetchedUrls.push(href);
    if (href.includes("/series/search?")) return new Response(searchPayload);
    if (href.includes("/series/observations?")) return new Response(observationsPayload);
    return new Response(JSON.stringify({ seriess: [gdpSeries] }));
  };

  const search = await searchFredSeries("GDP", { apiKey: "test-key", fetch });
  const series = await fetchFredSeries("GDP", { apiKey: "test-key", fetch });
  const observations = await fetchFredObservations("GDP", { apiKey: "test-key", fetch });

  expect(search.items[0]?.id).toBe("GDP");
  expect(series?.id).toBe("GDP");
  expect(observations.items[0]?.value).toBe(2.5);
  expect(fetchedUrls).toHaveLength(3);
  expect(
    fetchedUrls.every((href) => new URL(href).searchParams.get("api_key") === "test-key"),
  ).toBe(true);
});

test("zero limits return empty pages before transport I/O", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => {
    calls += 1;
    throw new Error("should not fetch");
  };

  const search = await searchFredSeries("GDP", {
    apiKey: "test-key",
    limit: 0,
    offset: 7,
    fetch,
  });
  const observations = await fetchFredObservations("GDP", {
    apiKey: "test-key",
    limit: 0,
    fetch,
  });
  expect(search).toEqual({ items: [], count: 0, offset: 7, limit: 0 });
  expect(observations).toEqual({ items: [], count: 0, offset: 0, limit: 0 });
  expect(calls).toBe(0);
});

test("blank keys fail as config errors before transport I/O", async () => {
  let calls = 0;
  try {
    await fetchFredSeries("GDP", {
      apiKey: "  ",
      fetch: async () => {
        calls += 1;
        return new Response("unexpected");
      },
    });
    throw new Error("expected fetchFredSeries to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(XnewsFetchError);
    if (!(error instanceof XnewsFetchError)) {
      throw new Error("expected blank FRED keys to throw XnewsFetchError", { cause: error });
    }
    expect(error.code).toBe("config");
  }
  expect(calls).toBe(0);
});

test("blank bound FRED keys are disabled by the data lane before network I/O", async () => {
  let fetchCalls = 0;
  const result = await fetchDataRelease(
    fredDataSource("GDP", {
      apiKey: "  ",
      fetch: async () => {
        fetchCalls += 1;
        return new Response("unexpected");
      },
    }),
  );

  expect(fetchCalls).toBe(0);
  expect(result).toMatchObject({
    provider: "fred",
    dataset: "GDP",
    status: "disabled",
    requestUrls: [],
    error: { code: "config" },
  });
});

test("transport failures redact the FRED API key", async () => {
  const apiKey = "never-leak-this-fred-key";
  try {
    await fetchFredObservations("GDP", {
      apiKey,
      fetch: async () => new Response("failure", { status: 503 }),
    });
    throw new Error("expected fetchFredObservations to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(XnewsFetchError);
    if (!(error instanceof XnewsFetchError)) {
      throw new Error("expected FRED transport failure to throw XnewsFetchError", { cause: error });
    }
    const failure = error;
    expect(failure.code).toBe("http_status");
    expect(failure.url).toContain("api_key=%3Credacted%3E");
    expect(failure.url).not.toContain(apiKey);
    expect(failure.message).not.toContain(apiKey);
  }
});

test("direct FRED fetches honor typed response byte caps exactly", async () => {
  const body = JSON.stringify({ seriess: [gdpSeries] });
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  const fetch = async (): Promise<Response> =>
    new Response(body, {
      headers: { "Content-Length": String(bodyBytes) },
    });

  const series = await fetchFredSeries("GDP", {
    apiKey: "test-key",
    maxResponseBytes: bodyBytes,
    fetch,
  });
  expect(series?.id).toBe("GDP");

  try {
    await fetchFredSeries("GDP", {
      apiKey: "test-key",
      maxResponseBytes: bodyBytes - 1,
      fetch,
    });
    throw new Error("expected the FRED response byte cap to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(XnewsFetchError);
    if (!(error instanceof XnewsFetchError)) {
      throw new Error("expected the FRED response byte cap to throw XnewsFetchError", {
        cause: error,
      });
    }
    expect(error.code).toBe("network");
  }
});

test("binds FRED observations to the structured data lane without leaking credentials", async () => {
  const apiKey = "bound-fred-secret";
  const requestedUrls: string[] = [];
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    requestedUrls.push(fetchInputUrl(input));
    return new Response(
      JSON.stringify({
        observations: [
          {
            realtime_start: "2026-08-01",
            realtime_end: "2026-08-01",
            date: "2024-01-01",
            value: "1.25",
          },
          {
            realtime_start: "2026-08-01",
            realtime_end: "2026-08-01",
            date: "2025-01-01",
            value: ".",
          },
          {
            realtime_start: "2026-08-01",
            realtime_end: "2026-08-01",
            date: "2026-01-01",
            value: "3.75",
          },
        ],
      }),
    );
  };
  const source = fredDataSource(" gdp ", {
    apiKey,
    observationStart: "2024-01-01",
    units: "pch",
    limit: 25,
    fetch,
  });

  const result = await fetchDataRelease(source);

  expect(result.status).toBe("ok");
  expect(result.provider).toBe("fred");
  expect(result.dataset).toBe("GDP");
  expect(result.release).toEqual({
    provider: "fred",
    dataset: "GDP",
    asOf: "2026-01-01",
    url: "https://fred.stlouisfed.org/series/GDP",
    rows: [
      {
        realtimeStart: "2026-08-01",
        realtimeEnd: "2026-08-01",
        date: "2024-01-01",
        value: 1.25,
        rawValue: "1.25",
      },
      {
        realtimeStart: "2026-08-01",
        realtimeEnd: "2026-08-01",
        date: "2025-01-01",
        value: null,
        rawValue: ".",
      },
      {
        realtimeStart: "2026-08-01",
        realtimeEnd: "2026-08-01",
        date: "2026-01-01",
        value: 3.75,
        rawValue: "3.75",
      },
    ],
  });
  expect(requestedUrls).toHaveLength(1);
  const requested = new URL(requestedUrls[0] ?? "");
  expect(requested.searchParams.get("api_key")).toBe(apiKey);
  expect(requested.searchParams.get("series_id")).toBe("GDP");
  expect(requested.searchParams.get("observation_start")).toBe("2024-01-01");
  expect(requested.searchParams.get("units")).toBe("pch");
  expect(requested.searchParams.get("limit")).toBe("25");

  expect(result.requestUrls).toHaveLength(1);
  expect(result.requestUrls[0]).not.toContain(apiKey);
  const observable = new URL(result.requestUrls[0] ?? "");
  expect(observable.searchParams.get("api_key")).toBe("<redacted>");
  expect(observable.searchParams.get("observation_start")).toBe("2024-01-01");
});

test("per-call transport overrides stay separate from bound FRED query options", async () => {
  const boundCalls: string[] = [];
  const perCallUrls: string[] = [];
  const payload = JSON.stringify({
    observations: [
      {
        realtime_start: "2026-08-01",
        realtime_end: "2026-08-01",
        date: "2026-04-01",
        value: "4",
      },
    ],
  });
  const source = fredDataSource("GDPC1", {
    apiKey: "bound-key",
    observationStart: "2000-01-01",
    units: "lin",
    limit: 10,
    fetch: async (input) => {
      boundCalls.push(fetchInputUrl(input));
      return new Response(payload);
    },
  });

  const boundResult = await fetchDataRelease(source);
  expect(boundResult.status).toBe("ok");
  expect(boundCalls).toHaveLength(1);

  const perCallOptions = {
    fetch: async (input: RequestInfo | URL): Promise<Response> => {
      perCallUrls.push(fetchInputUrl(input));
      return new Response(payload);
    },
    limit: 0,
    apiKey: "attempted-replacement",
    observationStart: "2099-01-01",
    units: "pch",
  };
  const perCallResult = await fetchDataRelease(source, perCallOptions);

  expect(perCallResult.status).toBe("ok");
  expect(boundCalls).toHaveLength(1);
  expect(perCallUrls).toHaveLength(1);
  const requested = new URL(perCallUrls[0] ?? "");
  expect(requested.searchParams.get("api_key")).toBe("bound-key");
  expect(requested.searchParams.get("observation_start")).toBe("2000-01-01");
  expect(requested.searchParams.get("units")).toBe("lin");
  expect(requested.searchParams.get("limit")).toBe("10");

  const equal = await fetchDataRelease(source, {
    fetch: perCallOptions.fetch,
    ifNewerThan: "2026-04-01",
  });
  const newer = await fetchDataRelease(source, {
    fetch: perCallOptions.fetch,
    ifNewerThan: "2027-01-01",
  });
  expect(equal.status).toBe("empty");
  expect(equal.release).toBeUndefined();
  expect(newer.status).toBe("empty");
  expect(newer.release).toBeUndefined();
});

test("per-call response byte caps override bound FRED data-source transport", async () => {
  const apiKey = "bound-fred-secret";
  const body = JSON.stringify({
    observations: [
      {
        realtime_start: "2026-08-01",
        realtime_end: "2026-08-01",
        date: "2026-04-01",
        value: "4",
      },
    ],
  });
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  const source = fredDataSource("GDP", {
    apiKey,
    maxResponseBytes: bodyBytes + 1,
    fetch: async () =>
      new Response(body, {
        headers: { "Content-Length": String(bodyBytes) },
      }),
  });

  const result = await fetchDataRelease(source, {
    maxResponseBytes: bodyBytes - 1,
  });

  expect(result.status).toBe("error");
  expect(result.error).toMatchObject({ code: "network" });
  const errorUrl = result.error?.url;
  expect(errorUrl).toContain("api_key=%3Credacted%3E");
  expect(errorUrl).not.toContain(apiKey);
  expect(result.requestUrls).toHaveLength(1);
  expect(result.requestUrls[0]).toContain("api_key=%3Credacted%3E");
  expect(result.requestUrls[0]).not.toContain(apiKey);
});

test("empty FRED observation responses produce no structured release", async () => {
  const source = fredDataSource("UNRATE", {
    apiKey: "test-key",
    fetch: async () => new Response(JSON.stringify({ observations: [] })),
  });

  const result = await fetchDataRelease(source);

  expect(result.status).toBe("empty");
  expect(result.rowCount).toBe(0);
  expect(result.release).toBeUndefined();
});

test("malformed JSON errors never expose upstream response content", () => {
  const reflectedSecret = "api_key=reflected-secret";
  try {
    parseFredSeries(`<html>${reflectedSecret}</html>`);
    throw new Error("expected parseFredSeries to reject malformed JSON");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("expected malformed FRED JSON to throw an Error", { cause: error });
    }
    expect(error.message).toContain("non-JSON FRED series response");
    expect(error.message).not.toContain(reflectedSecret);
  }
});
