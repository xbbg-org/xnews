/**
 * Live smoke for the FFIEC CDR data lane: drives the real postback chain to
 * list reporting periods, downloads the latest single-period call-report
 * TSV archive (~6 MB), parses it, and exercises the filtered data source,
 * the ifNewerThan skip, and the news adapter end to end. Catches CDR page
 * markup drift that fixtures cannot.
 */

import {
  fetchDataRelease,
  fetchFfiecReportingPeriods,
  ffiecCallDataSource,
  ffiecReleaseToNewsItems,
  ffiecReportingPeriodDate,
} from "../src/index.js";

// JPMorgan Chase Bank NA and Bank of America NA lead bank RSSD IDs.
const RSSD_IDS = [852218, 480228];
const OPTIONS = { timeoutMs: 120_000 };

let failures = 0;

const periods = await fetchFfiecReportingPeriods("call-single", OPTIONS);
const latest = periods[0];
const latestDate = latest === undefined ? undefined : ffiecReportingPeriodDate(latest);
if (latest === undefined || latestDate === undefined) {
  console.log("FAIL no reporting periods for call-single");
  failures += 1;
} else {
  console.log(`ok   ${periods.length} periods, latest ${latest.label} (${latestDate})`);
}

const source = ffiecCallDataSource({ ...OPTIONS, rssdIds: RSSD_IDS, schedules: ["RC", "RI"] });
const result = await fetchDataRelease(source);
if (result.status !== "ok" || !result.release) {
  console.log(`FAIL call release: ${result.error?.message ?? result.status}`);
  failures += 1;
} else {
  const { release } = result;
  console.log(
    `ok   release asOf ${release.asOf} updated ${release.updatedAt ?? "-"} rows ${result.rowCount} (${result.durationMs}ms)`,
  );
  const filers = new Set(release.rows.map((row) => row.rssdId));
  if (release.rows.length === 0 || ![...filers].every((rssd) => RSSD_IDS.includes(rssd))) {
    console.log(`FAIL row filter leaked filers: ${[...filers].join(", ")}`);
    failures += 1;
  }
  const totalAssets = release.rows.find(
    (row) => row.schedule === "RC" && row.values["RCFD2170"] !== undefined,
  );
  console.log(
    totalAssets
      ? `ok   ${totalAssets.name ?? totalAssets.rssdId} RCFD2170 (total assets, $K) = ${totalAssets.values["RCFD2170"]}`
      : "warn RCFD2170 not present on schedule RC rows",
  );
  for (const item of ffiecReleaseToNewsItems(release)) console.log(`     ${item.title}`);

  const skipped = await fetchDataRelease(source, { ...OPTIONS, ifNewerThan: release.asOf });
  if (skipped.status !== "empty") {
    console.log(`FAIL ifNewerThan did not skip: ${skipped.status}`);
    failures += 1;
  } else {
    console.log(`ok   ifNewerThan ${release.asOf} skipped in ${skipped.durationMs}ms`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
