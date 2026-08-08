import {
  fetchDataRelease,
  fetchHmdaAggregations,
  fetchHmdaCount,
  fetchHmdaFilers,
  fetchHmdaLoanRecords,
  fetchHmdaPipeLoanRecords,
  hmdaDataSource,
} from "../src/index.js";

const OPTIONS = { timeoutMs: 120_000, maxResponseBytes: 4 * 1024 * 1024 };
const DC_2023 = { years: 2023, states: "DC" as const };
const ORIGINATIONS_2023 = { ...DC_2023, actions_taken: 1 as const };
const LOANDEPOT_LEI = "549300AG64NHILB7ZP05";
let failures = 0;

async function check(label: string, probe: () => Promise<string>): Promise<void> {
  try {
    console.log(`ok   ${await probe()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${label}: ${message}`);
    failures += 1;
  }
}

await check("count", async () => {
  const row = await fetchHmdaCount(DC_2023, OPTIONS);
  if (row?.count !== 17_474 || row.sum !== 11_458_390_000) {
    throw new Error(`expected 17,474 records / $11,458,390,000, got ${row?.count} / ${row?.sum}`);
  }
  return `2023 DC count ${row.count.toLocaleString()} sum $${row.sum.toLocaleString()}`;
});

await check("aggregation", async () => {
  const rows = await fetchHmdaAggregations(ORIGINATIONS_2023, OPTIONS);
  const row = rows.find((candidate) => candidate.dimensions.actions_taken === "1");
  if (row?.count !== 8_616 || row.sum !== 6_107_540_000) {
    throw new Error(
      `expected 8,616 originations / $6,107,540,000, got ${row?.count} / ${row?.sum}`,
    );
  }
  return `2023 DC originations ${row.count.toLocaleString()} sum $${row.sum.toLocaleString()}`;
});

await check("filers", async () => {
  const filers = await fetchHmdaFilers(DC_2023, { ...OPTIONS, limit: 250 });
  const loanDepot = filers.find((filer) => filer.lei === LOANDEPOT_LEI);
  if (loanDepot?.count !== 114 || loanDepot.period !== 2023) {
    throw new Error(`LOANDEPOT filer mismatch: ${loanDepot?.count} / ${loanDepot?.period}`);
  }
  return `${filers.length} 2023 DC filers; ${loanDepot.name} has ${loanDepot.count} records`;
});

const loanQuery = { ...ORIGINATIONS_2023, leis: LOANDEPOT_LEI };
await check("CSV", async () => {
  const rows = await fetchHmdaLoanRecords(loanQuery, { ...OPTIONS, limit: 2 });
  if (rows.length !== 2 || rows.some((row) => row.activityYear !== 2023 || row.actionTaken !== 1)) {
    throw new Error(`expected two typed 2023 origination rows, got ${rows.length}`);
  }
  return `modified-LAR CSV parsed ${rows.length} rows; first tract ${rows[0]?.censusTract}`;
});

await check("pipe", async () => {
  const rows = await fetchHmdaPipeLoanRecords(loanQuery, { ...OPTIONS, limit: 1 });
  if (rows.length !== 1 || rows[0]?.raw["lei"] !== LOANDEPOT_LEI) {
    throw new Error(`expected one verbatim pipe row, got ${rows.length}`);
  }
  return `modified-LAR pipe parsed LEI ${rows[0].lei}`;
});

await check("data source", async () => {
  const source = hmdaDataSource(2023, { states: "DC", actions_taken: 1, ...OPTIONS });
  const release = await fetchDataRelease(source);
  if (release.status !== "ok" || release.release?.asOf !== "2023-12-31") {
    throw new Error(release.error?.message ?? `unexpected ${release.status} release`);
  }
  const latestProbe = await fetchDataRelease(source, { ...OPTIONS, ifNewerThan: "2025-12-31" });
  if (latestProbe.status !== "empty") {
    throw new Error(`2026 availability probe returned ${latestProbe.status}`);
  }
  return `data lane asOf ${release.release.asOf}; 2026 count probe reports no newer year`;
});

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
