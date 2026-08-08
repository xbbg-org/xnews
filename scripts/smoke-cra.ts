/** Live smoke for the annual FFIEC CRA fixed-width flat files. */

import {
  craDataSource,
  fetchCraAvailableYears,
  fetchCraFlatFile,
  fetchDataRelease,
} from "../src/index.js";

const OPTIONS = { timeoutMs: 120_000, limit: 25 } as const;
let failures = 0;

const fail = (message: string): void => {
  console.log(`FAIL ${message}`);
  failures += 1;
};

let latest: number | undefined;
try {
  const years = await fetchCraAvailableYears({ timeoutMs: OPTIONS.timeoutMs });
  latest = years[0];
  if (latest === undefined) fail("flat-files catalog exposed no activity years");
  else console.log(`ok   ${years.length} CRA activity years, latest ${latest}`);
} catch (error) {
  fail(`catalog: ${error instanceof Error ? error.message : String(error)}`);
}

if (latest !== undefined) {
  try {
    const file = await fetchCraFlatFile(latest, "aggregate", OPTIONS);
    const first = file.rows[0];
    if (first === undefined) {
      fail(`${latest} aggregate archive parsed no rows`);
    } else {
      console.log(
        `ok   ${latest} aggregate ${(file.archiveSizeBytes / 1024 / 1024).toFixed(1)} MiB, ` +
          `${file.files.length} files validated, ${file.rows.length} rows retained, first ${first.recordType}`,
      );
    }
  } catch (error) {
    fail(`${latest} aggregate: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const source = craDataSource("aggregate", { year: latest, ...OPTIONS });
    const release = await fetchDataRelease(source, { ifNewerThan: `${latest}-12-31` });
    if (release.status !== "empty") fail(`ifNewerThan returned ${release.status}`);
    else console.log(`ok   ifNewerThan ${latest}-12-31 skipped the archive download`);
  } catch (error) {
    fail(`ifNewerThan: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
