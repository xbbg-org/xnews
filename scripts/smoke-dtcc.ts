/**
 * Live smoke for the DTCC swap-dissemination data lane: reads the slice
 * catalog for every verified (agency, asset class) pair, downloads and
 * parses one real slice through `dtccSliceDataSource` + `fetchDataRelease`,
 * fetches the newest cumulative end-of-day file, and exercises the news
 * adapter end to end. Catches endpoint moves and CSV column renames that
 * fixtures cannot.
 */

import {
  type DtccAgency,
  type DtccAssetClass,
  dtccReleaseToNewsItems,
  dtccSliceDataSource,
  fetchDataRelease,
  fetchDtccCumulativeEvents,
  fetchDtccSliceCatalog,
} from "../src/index.js";

let failures = 0;

const CATALOG_PAIRS: readonly { agency: DtccAgency; assetClass: DtccAssetClass }[] = [
  { agency: "cftc", assetClass: "credits" },
  { agency: "cftc", assetClass: "rates" },
  { agency: "cftc", assetClass: "equities" },
  { agency: "cftc", assetClass: "forex" },
  { agency: "cftc", assetClass: "commodities" },
  { agency: "sec", assetClass: "credits" },
  { agency: "sec", assetClass: "equities" },
  { agency: "sec", assetClass: "rates" },
];

for (const pair of CATALOG_PAIRS) {
  const label = `${pair.agency}/${pair.assetClass}`.padEnd(18);
  try {
    const catalog = await fetchDtccSliceCatalog(pair);
    const newest = catalog.at(-1);
    console.log(`ok   catalog ${label} ${catalog.length} slices, newest ${newest?.fileName}`);
    if (catalog.length === 0) {
      console.log(`FAIL catalog ${label} is empty`);
      failures += 1;
    }
  } catch (error) {
    console.log(`FAIL catalog ${label} ${error instanceof Error ? error.message : String(error)}`);
    failures += 1;
  }
}

// One real slice through the data lane (CFTC credits, latest slice).
const sliceResult = await fetchDataRelease(dtccSliceDataSource({ assetClass: "credits" }));
if (sliceResult.status === "ok" && sliceResult.release) {
  const release = sliceResult.release;
  const first = release.rows[0];
  console.log(
    `ok   slice ${release.url.split("/").at(-1)} seq ${release.sequence} rows ${sliceResult.rowCount} (${sliceResult.durationMs}ms)`,
  );
  if (first?.disseminationId === undefined || first.disseminationId.length === 0) {
    console.log("FAIL slice rows carry no dissemination id");
    failures += 1;
  }
  for (const item of dtccReleaseToNewsItems(release)) console.log(`     ${item.title}`);
} else {
  console.log(`FAIL slice lane: ${sliceResult.error?.message ?? sliceResult.status}`);
  failures += 1;
}

// Newest cumulative end-of-day file (walks back from today).
const eod = await fetchDtccCumulativeEvents(undefined, { assetClass: "credits", limit: 50 });
if (eod === undefined) {
  console.log("FAIL cumulative walk-back found no published file");
  failures += 1;
} else {
  console.log(`ok   cumulative ${eod.fileName} rows ${eod.events.length} (capped at 50)`);
  const missingUpi = eod.events.every((event) => event.uniqueProductIdentifier === null);
  if (missingUpi) {
    console.log("FAIL cumulative rows carry no Unique Product Identifier column");
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
