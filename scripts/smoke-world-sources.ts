/**
 * Live smoke for the sources added alongside the events lane: prediction
 * markets, keyless quotes, federal money, macro/climate/energy series, active
 * hazard feeds, cyber and infrastructure status, humanitarian data, and the
 * observation directories.
 *
 * Fixtures pin the parse contract; only a live call catches the failures that
 * actually happen to these publishers — a renamed field, a moved dataset, a
 * feed that quietly starts answering HTML. Every publisher here is keyless.
 *
 * Seasonal feeds legitimately report nothing (no active hurricanes, no
 * elevated volcanoes, no tsunami messages), so an empty result from those is
 * reported as `none` and is not a failure. A failure is a transport error, a
 * shape error, or a publisher that should always have rows returning none.
 */

import {
  caisoFuelMixDataSource,
  carbonIntensityDataSource,
  cdcWastewaterDataSource,
  cisaKevDataSource,
  droughtMonitorDataSource,
  faaStatusSource,
  fetchDataRelease,
  fetchDeepStateMapFrontline,
  fetchEventSnapshot,
  fetchKalshiMarkets,
  fetchManifoldMarkets,
  fetchOfacActions,
  fetchPolymarketMarkets,
  fetchTrafficCameras,
  fetchWhoOutbreaks,
  fetchYahooBars,
  fetchYahooQuote,
  gdacsSource,
  gdeltEventsSource,
  glofasFloodSource,
  grantsGovDataSource,
  hungerMapDataSource,
  iodaDataSource,
  nasaGistempDataSource,
  nhcStormsSource,
  noaaCo2DataSource,
  noaaOniDataSource,
  noaaTsunamiSource,
  nwsAlertsSource,
  ooniDataSource,
  safecastSource,
  sondeHubSource,
  unhcrDataSource,
  usaSpendingDataSource,
  usgsVolcanoesSource,
  wikipediaPageviewsDataSource,
  wikipediaCongressEditsDataSource,
  worldBankIndicatorDataSource,
  YAHOO_FUTURES_SYMBOLS,
} from "../src/index.js";
import type { DataSource, EventSource } from "../src/index.js";

let failures = 0;
let empties = 0;

type Outcome = { readonly detail: string; readonly count: number };

/** Publishers whose feed is legitimately empty when nothing is happening. */
const MAY_BE_EMPTY: Record<string, true> = {
  "nhc-storms": true,
  "usgs-volcanoes": true,
  "noaa-tsunami": true,
  "faa-status": true,
  gdacs: true,
  "glofas-flood": true,
};

async function check(label: string, run: () => Promise<Outcome>): Promise<void> {
  const startedAt = Date.now();
  try {
    const { detail, count } = await run();
    const elapsed = `${Date.now() - startedAt}ms`;
    if (count === 0) {
      const tolerated = MAY_BE_EMPTY[label] === true;
      if (!tolerated) failures += 1;
      else empties += 1;
      console.log(`${tolerated ? "none" : "FAIL"} ${label.padEnd(24)} ${detail} (${elapsed})`);
      return;
    }
    console.log(`ok   ${label.padEnd(24)} ${detail} (${elapsed})`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${label.padEnd(24)} ${message} (${Date.now() - startedAt}ms)`);
  }
}

async function checkRelease<Row>(label: string, source: DataSource<Row>): Promise<void> {
  await check(label, async () => {
    const result = await fetchDataRelease(source);
    if (result.status === "error" || result.status === "disabled") {
      throw new Error(result.error?.message ?? "release failed");
    }
    return {
      detail: `asOf ${result.release?.asOf ?? "-"} rows ${result.rowCount}`,
      count: result.rowCount,
    };
  });
}

async function checkSnapshot(label: string, source: EventSource): Promise<void> {
  await check(label, async () => {
    const result = await fetchEventSnapshot(source);
    if (result.status === "error" || result.status === "disabled") {
      throw new Error(result.error?.message ?? "snapshot failed");
    }
    const top = result.events[0];
    const warned = result.warnings.length > 0 ? ` warnings ${result.warnings.length}` : "";
    return {
      detail: `events ${result.eventCount}${warned}${top ? ` top=${top.severity} ${top.title.slice(0, 40)}` : ""}`,
      count: result.eventCount,
    };
  });
}

console.log("— prediction markets & quotes —");
await check("kalshi", async () => {
  const quotes = await fetchKalshiMarkets({ limit: 20 });
  const bad = quotes.filter((q) => !(q.probability >= 0 && q.probability <= 1));
  if (bad.length > 0) throw new Error(`${bad.length} out-of-range probabilities`);
  // A cent/dollar regression would push every quote under 1%.
  if (quotes.length > 5 && quotes.every((q) => q.probability < 0.01)) {
    throw new Error("every probability under 1% — price scale regression");
  }
  return { detail: `quotes ${quotes.length}`, count: quotes.length };
});
await check("polymarket", async () => {
  const quotes = await fetchPolymarketMarkets({ limit: 20 });
  return { detail: `quotes ${quotes.length}`, count: quotes.length };
});
await check("manifold", async () => {
  const quotes = await fetchManifoldMarkets({ limit: 20 });
  return { detail: `quotes ${quotes.length}`, count: quotes.length };
});
await check("yahoo-quote", async () => {
  const quote = await fetchYahooQuote("CL=F");
  if (!quote) throw new Error("no quote");
  return { detail: `CL=F ${quote.price} ${quote.currency ?? ""}`, count: 1 };
});
await check("yahoo-bars", async () => {
  const bars = await fetchYahooBars("^VIX", { interval: "1d", range: "1mo" });
  return { detail: `^VIX bars ${bars.length}`, count: bars.length };
});
await check("yahoo-futures-curve", async () => {
  const symbols = Object.keys(YAHOO_FUTURES_SYMBOLS).slice(0, 4);
  const quotes = await Promise.all(symbols.map((symbol) => fetchYahooQuote(symbol)));
  const priced = quotes.filter((quote) => quote !== undefined);
  return { detail: `${priced.length}/${symbols.length} priced`, count: priced.length };
});

console.log("\n— sanctions, federal money & filings —");
await check("ofac", async () => {
  const items = await fetchOfacActions({}, { limit: 10 });
  return {
    detail: `actions ${items.length} latest=${items[0]?.publishedAt ?? "-"}`,
    count: items.length,
  };
});
await checkRelease("usaspending", usaSpendingDataSource({ limit: 10 }));
await checkRelease("grants-gov", grantsGovDataSource({ limit: 10 }));

console.log("\n— macro, climate & energy —");
await checkRelease(
  "world-bank/inflation",
  worldBankIndicatorDataSource({ indicator: "inflation" }),
);
await checkRelease("world-bank/gdp", worldBankIndicatorDataSource({ indicator: "gdp-growth" }));
await checkRelease("noaa-oni", noaaOniDataSource());
await checkRelease("drought-monitor", droughtMonitorDataSource());
await checkRelease("carbon-intensity", carbonIntensityDataSource());
await checkRelease("caiso-fuel-mix", caisoFuelMixDataSource());
await checkRelease("noaa-co2", noaaCo2DataSource());
await checkRelease("nasa-gistemp", nasaGistempDataSource());

console.log("\n— active hazards (events lane) —");
await checkSnapshot("nws-alerts", nwsAlertsSource());
await checkSnapshot("nhc-storms", nhcStormsSource());
await checkSnapshot("gdacs", gdacsSource());
await checkSnapshot("usgs-volcanoes", usgsVolcanoesSource());
await checkSnapshot("noaa-tsunami", noaaTsunamiSource());
await checkSnapshot("glofas-flood", glofasFloodSource());
await checkSnapshot("gdelt-events", gdeltEventsSource({ limit: 50 }));

console.log("\n— cyber, infrastructure & attention —");
await checkRelease("cisa-kev", cisaKevDataSource());
await checkSnapshot("faa-status", faaStatusSource());
await checkRelease("ioda-outages", iodaDataSource());
await checkRelease("ooni-censorship", ooniDataSource());
await checkRelease("wikipedia-pageviews", wikipediaPageviewsDataSource({ limit: 10 }));
await checkRelease(
  "wikipedia-congress",
  wikipediaCongressEditsDataSource({ chambers: ["house", "senate"], limit: 10 }),
);

console.log("\n— health & humanitarian —");
await check("who-outbreaks", async () => {
  const items = await fetchWhoOutbreaks({}, { limit: 10 });
  return { detail: `articles ${items.length}`, count: items.length };
});
await checkRelease("cdc-wastewater", cdcWastewaterDataSource({ limit: 20 }));
await checkRelease("unhcr-displacement", unhcrDataSource({ limit: 20 }));
await check("wfp-hungermap", async () => {
  const result = await fetchDataRelease(hungerMapDataSource());
  if (result.status !== "disabled" || result.error?.code !== "config") {
    throw new Error(`expected missing credentials to disable source; received ${result.status}`);
  }
  return { detail: "disabled until caller supplies WFP apiKey (expected)", count: 1 };
});

console.log("\n— observations —");
await checkSnapshot("safecast-radiation", safecastSource());
await checkSnapshot("sondehub-balloons", sondeHubSource());
await check("traffic-cameras", async () => {
  const result = await fetchTrafficCameras(["nyc", "tfl", "deldot", "nzta"]);
  const failed = result.errors.map((entry) => entry.network).join(",");
  return {
    detail: `cameras ${result.cameras.length}${failed ? ` failed=[${failed}]` : ""}`,
    count: result.cameras.length,
  };
});
await check("deepstatemap", async () => {
  const snapshot = await fetchDeepStateMapFrontline();
  return { detail: `features ${snapshot.features.length}`, count: snapshot.features.length };
});

console.log(
  `\n${failures} failure(s), ${empties} publisher(s) legitimately reporting nothing right now`,
);
if (failures > 0) process.exitCode = 1;
