/**
 * Live smoke for the CFTC COT data lane: fetches the latest week of every
 * dataset through `cotDataSource` + `fetchDataRelease`, then exercises
 * market-preset filtering and the news adapter end to end. Catches upstream
 * column renames and dataset moves that fixtures cannot.
 */

import {
  COT_DATASETS,
  cotDataSource,
  cotReleaseToNewsItems,
  fetchCotReport,
  fetchDataRelease,
} from "../src/index.js";

let failures = 0;

for (const definition of COT_DATASETS) {
  const source = cotDataSource(definition.family, {
    combined: definition.combined,
    limit: 3,
  });
  const result = await fetchDataRelease(source);
  const summary =
    result.status === "ok"
      ? `asOf ${result.release?.asOf} rows ${result.rowCount}`
      : (result.error?.message ?? "no data");
  console.log(
    `${result.status === "ok" ? "ok  " : "FAIL"} ${definition.dataset.padEnd(28)} ${summary} (${result.durationMs}ms)`,
  );
  if (result.status !== "ok") failures += 1;
}

const filtered = await fetchCotReport("tff", { markets: ["ZN", "ES"], limit: 10 });
if (!filtered || filtered.rows.length === 0) {
  console.log("FAIL market-filtered TFF fetch returned no rows");
  failures += 1;
} else {
  console.log(`ok   market filter [ZN, ES] -> ${filtered.rows.length} rows, asOf ${filtered.asOf}`);
  const items = cotReleaseToNewsItems(filtered);
  for (const item of items) console.log(`     ${item.title}`);
  const codes = new Set(filtered.rows.map((row) => row.cftcContractMarketCode));
  const unexpected = [...codes].filter((code) => code !== "043602" && code !== "13874A");
  if (unexpected.length > 0) {
    console.log(`FAIL market filter leaked codes: ${unexpected.join(", ")}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
