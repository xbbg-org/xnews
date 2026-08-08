/**
 * Live smoke for the FFIEC E.16 lane: discovers the irregular current link,
 * parses all population tables, prints one real country exposure, and checks
 * that the index period can suppress the workbook download.
 */

import {
  fetchDataRelease,
  fetchFfiecE16Release,
  ffiecE16DataSource,
  listFfiecE16Releases,
} from "../src/index.js";

const OPTIONS = { timeoutMs: 120_000 };
let failures = 0;

const releases = await listFfiecE16Releases(OPTIONS);
const latest = releases[0];
if (latest === undefined) {
  console.log("FAIL release index contained no E.16 data files");
  failures += 1;
} else {
  console.log(
    `ok   index ${releases.length} releases; latest ${latest.reportingPeriod} ` +
      `${latest.format} ${latest.url}`,
  );

  const release = await fetchFfiecE16Release(latest, { ...OPTIONS, limit: 1 });
  const country = release.rows[0];
  const crossBorder = country?.measures.find(
    (measure) => measure.name === "ultimateRiskCrossBorderClaims",
  );
  if (country === undefined || crossBorder?.value === undefined) {
    console.log("FAIL current workbook had no typed country exposure row");
    failures += 1;
  } else {
    console.log(
      `ok   workbook ${release.sheetNames.length} sheets, asOf ${release.asOf}, ` +
        `${country.population}/${country.table} ${country.countryOrRegion} ` +
        `region=${country.region ?? "-"} ultimateRiskCrossBorderClaims=${crossBorder.value}`,
    );
  }

  const skipped = await fetchDataRelease(ffiecE16DataSource(OPTIONS), {
    ...OPTIONS,
    ifNewerThan: release.asOf,
  });
  if (skipped.status !== "empty") {
    console.log(`FAIL ifNewerThan did not skip: ${skipped.status}`);
    failures += 1;
  } else {
    console.log(`ok   ifNewerThan ${release.asOf} skipped before workbook download`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
