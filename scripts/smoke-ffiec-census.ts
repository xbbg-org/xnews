import {
  FFIEC_CENSUS_ARCHIVES,
  fetchDataRelease,
  fetchFfiecGeocode,
  ffiecCensusDataSource,
} from "../src/index.js";

const latestYear = Math.max(...Object.keys(FFIEC_CENSUS_ARCHIVES).map(Number));
const options = { timeoutMs: 300_000 };
let failures = 0;

const source = ffiecCensusDataSource(latestYear, { ...options, limit: 3 });
const result = await fetchDataRelease(source);
if (result.status !== "ok" || result.release === undefined || result.release.rows.length === 0) {
  console.log(`FAIL census ${latestYear}: ${result.error?.message ?? result.status}`);
  failures += 1;
} else {
  const first = result.release.rows[0];
  console.log(
    `ok   census ${latestYear} asOf ${result.release.asOf}: ${result.rowCount} sampled tract rows; ` +
      `first ${first?.fipsState}${first?.fipsCounty}${first?.fipsTract}`,
  );
  const skipped = await fetchDataRelease(source, {
    ...options,
    ifNewerThan: result.release.asOf,
  });
  if (skipped.status !== "empty") {
    console.log(`FAIL census ifNewerThan did not skip: ${skipped.status}`);
    failures += 1;
  } else {
    console.log(`ok   census ifNewerThan ${result.release.asOf} skipped`);
  }
}

try {
  const geocode = await fetchFfiecGeocode(
    "1600 Pennsylvania Avenue NW, Washington, DC 20500",
    options,
  );
  if (geocode === undefined) {
    console.log("FAIL geocode returned no FFIEC tract");
    failures += 1;
  } else {
    console.log(
      `ok   geocode ${geocode.matchedAddress ?? "matched address"}: ` +
        `${geocode.stateCode}-${geocode.countyCode}-${geocode.tract}, ` +
        `MSA/MD ${geocode.msaMdCode}, census ${geocode.censusYear}`,
    );
  }
} catch (error) {
  console.log(`FAIL geocode: ${error instanceof Error ? error.message : String(error)}`);
  failures += 1;
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
