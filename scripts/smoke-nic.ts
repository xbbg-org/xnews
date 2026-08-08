/**
 * Live smoke for the NIC structure-data lane: validates the current product
 * page, downloads the active-institutions CSV ZIP through its direct GET
 * action, prints a real RSSD-keyed row, and verifies the page-stamp skip.
 */

import {
  fetchDataRelease,
  fetchNicBulkPage,
  NIC_BULK_PRODUCTS,
  nicDataSource,
} from "../src/index.js";

const OPTIONS = { timeoutMs: 120_000 };
let failures = 0;

const page = await fetchNicBulkPage(OPTIONS);
if (page.products.length !== NIC_BULK_PRODUCTS.length) {
  console.log(`FAIL product page returned ${page.products.length} products`);
  failures += 1;
} else {
  console.log(
    `ok   ${page.products.length} direct CSV ZIP products: ${page.products
      .map((product) => `${product.product} (${product.updatedAt})`)
      .join(", ")}`,
  );
}

const source = nicDataSource("attributes-active", { ...OPTIONS, limit: 1 });
const result = await fetchDataRelease(source);
if (result.status !== "ok" || result.release === undefined) {
  console.log(`FAIL active institution release: ${result.error?.message ?? result.status}`);
  failures += 1;
} else {
  const institution = result.release.rows[0];
  if (institution === undefined || !("rssdId" in institution) || institution.rssdId === undefined) {
    console.log("FAIL active institution release had no RSSD-keyed row");
    failures += 1;
  } else {
    console.log(
      `ok   RSSD ${institution.rssdId}: ${"name" in institution ? (institution.name ?? "-") : "-"} ` +
        `(${"entityType" in institution ? (institution.entityType ?? "-") : "-"}), asOf ${result.release.asOf}`,
    );
  }

  const skipped = await fetchDataRelease(source, {
    ...OPTIONS,
    ifNewerThan: result.release.asOf,
  });
  if (skipped.status !== "empty") {
    console.log(`FAIL ifNewerThan did not skip: ${skipped.status}`);
    failures += 1;
  } else {
    console.log(`ok   ifNewerThan ${result.release.asOf} skipped before archive download`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
