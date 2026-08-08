/**
 * Live smoke for NPW's institution-level FFIEC 002 financial-report CSV.
 * Deutsche Bank AG's New York branch is a long-running public filer whose
 * total-assets line provides a stable typed-row assertion.
 */

import { fetchDataRelease, ffiec002DataSource } from "../src/index.js";

const RSSD_ID = 112819;
const REPORTING_DATE = "2026-06-30";
const OPTIONS = { timeoutMs: 120_000 };

let failures = 0;

const result = await fetchDataRelease(
  ffiec002DataSource({ rssdId: RSSD_ID, reportingDate: REPORTING_DATE }, OPTIONS),
);
if (result.status !== "ok" || !result.release) {
  console.log(`FAIL FFIEC 002 release: ${result.error?.message ?? result.status}`);
  failures += 1;
} else {
  const { release } = result;
  const totalAssets = release.rows.find((row) => row.mdrm === "RCFD2170");
  if (
    release.asOf !== REPORTING_DATE ||
    release.rows.length === 0 ||
    !release.rows.every((row) => row.rssdId === RSSD_ID)
  ) {
    console.log(
      `FAIL FFIEC 002 release identity: asOf ${release.asOf}, rows ${release.rows.length}`,
    );
    failures += 1;
  } else {
    console.log(
      `ok   FFIEC 002 RSSD ${RSSD_ID} asOf ${release.asOf}: ${release.rows.length} line items (${result.durationMs}ms)`,
    );
  }

  if (totalAssets?.numericValue === undefined) {
    console.log("FAIL FFIEC 002 RCFD2170 total-assets line is missing or non-numeric");
    failures += 1;
  } else {
    console.log(`ok   RCFD2170 total assets ($000s) = ${totalAssets.numericValue}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
