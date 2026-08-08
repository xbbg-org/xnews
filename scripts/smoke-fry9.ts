/** Live smoke for NPW's combined FR Y-9 holding-company archive. */

import {
  downloadFry9Archive,
  fetchDataRelease,
  fetchFry9Page,
  fry9ArchiveUrl,
  fry9DataSource,
  parseFry9Archive,
} from "../src/index.js";

const OPTIONS = { timeoutMs: 120_000 };
let failures = 0;

const catalog = await fetchFry9Page(undefined, OPTIONS);
const latestYear = catalog.years.toSorted((left, right) => right - left)[0];
if (latestYear === undefined) {
  console.log("FAIL catalog returned no archive years");
  process.exitCode = 1;
} else {
  console.log(
    `ok   ${catalog.reports.length} forms: ${catalog.reports
      .map((definition) => `${definition.formId} (${definition.cadence})`)
      .join(", ")}`,
  );

  const page = await fetchFry9Page(latestYear, OPTIONS);
  const period = page.periods
    .filter((candidate) => candidate.reports.includes("fry9c"))
    .toSorted((left, right) => right.periodEnd.localeCompare(left.periodEnd))[0];
  if (period === undefined) {
    console.log(`FAIL ${latestYear} page returned no FR Y-9C period`);
    failures += 1;
  } else {
    console.log(
      `ok   ${latestYear} periods: ${page.periods
        .map((candidate) => `${candidate.periodEnd} [${candidate.reports.join(",")}]`)
        .join(", ")}`,
    );

    const download = await downloadFry9Archive("fry9c", period.periodEnd, OPTIONS);
    const rows = await parseFry9Archive(download.bytes, "fry9c", period.periodEnd, { limit: 1 });
    const row = rows[0];
    console.log(
      `ok   GET ${fry9ArchiveUrl("fry9c", period.periodEnd)}: ${download.contentType ?? "unknown type"}, ${download.bytes.length} bytes`,
    );
    if (row?.rssdId === undefined) {
      console.log("FAIL archive had no RSSD-keyed FR Y-9C row");
      failures += 1;
    } else {
      console.log(
        `ok   RSSD ${row.rssdId}: ${row.name ?? "-"}, ${Object.keys(row.values).length} non-empty MDRM items, asOf ${row.periodEnd}`,
      );
    }

    const skipped = await fetchDataRelease(
      fry9DataSource("fry9c", { ...OPTIONS, period: period.periodEnd, limit: 1 }),
      { ifNewerThan: period.periodEnd },
    );
    if (skipped.status !== "empty") {
      console.log(`FAIL ifNewerThan did not skip: ${skipped.status}`);
      failures += 1;
    } else {
      console.log(`ok   ifNewerThan ${period.periodEnd} skipped before archive download`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
