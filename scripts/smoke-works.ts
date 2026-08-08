/**
 * Live smoke for the works lane: runs every catalog adapter against its real
 * upstream and reports what each returned.
 *
 * Mirror-based adapters (Library Genesis, Anna's Archive) read their origins
 * from a deployment-local mirror list, because this package ships none. Point
 * `XNEWS_MIRRORS_FILE` at your list, or drop one at `mirrors.local.txt`; those
 * adapters are skipped, not failed, when no pool is configured.
 *
 * Fixtures cannot catch an upstream layout change. This can.
 */

import {
  annasArchiveSource,
  internetArchiveSource,
  libgenSource,
  loadMirrorList,
  mirrorBaseUrls,
  openLibrarySource,
  searchWorks,
  type MirrorList,
  type WorksResult,
  type WorksSource,
} from "../src/index.js";

const QUERY = { query: "dune messiah", limit: 5 } as const;
const TIMEOUT_MS = 45_000;

let failures = 0;

function report(result: WorksResult, note = ""): void {
  const summary =
    result.status === "ok" || result.status === "partial"
      ? `${result.recordCount} record(s)`
      : (result.error?.message ?? result.status);
  const flag = result.status === "ok" || result.status === "partial" ? "ok  " : "FAIL";
  console.log(`${flag} ${result.provider.padEnd(18)} ${summary} (${result.durationMs}ms)${note}`);
  for (const warning of result.warnings.slice(0, 3)) console.log(`       warn: ${warning}`);
  const first = result.items[0];
  if (first !== undefined) {
    const ids = [
      first.identity.isbn13 === undefined ? "" : `isbn13=${first.identity.isbn13}`,
      first.identity.md5 === undefined ? "" : `md5=${first.identity.md5.slice(0, 12)}…`,
    ]
      .filter((part) => part !== "")
      .join(" ");
    console.log(
      `       ${first.title.slice(0, 58)} | ${first.authors[0] ?? "?"} | ${first.availability}${ids === "" ? "" : ` | ${ids}`}`,
    );
  }
  if (flag === "FAIL") failures += 1;
}

async function run(source: WorksSource, note = ""): Promise<void> {
  report(await searchWorks(source, { ...QUERY, timeoutMs: TIMEOUT_MS }), note);
}

// Catalogs with a stable official origin.
await run(openLibrarySource());
await run(internetArchiveSource());

// Mirror-based catalogs. No pool configured is a skip, not a failure: the
// whole point of the mirror list is that it is the operator's to supply.
let list: MirrorList | undefined;
try {
  list = await loadMirrorList();
} catch (error) {
  console.log(
    `skip mirror pools        ${error instanceof Error ? error.message : "unknown error"}`,
  );
}

if (list !== undefined) {
  for (const warning of list.warnings) console.log(`     mirror-list warn: ${warning}`);

  const libgenMirrors = mirrorBaseUrls(list, "libgen");
  if (libgenMirrors.length === 0) console.log("skip libgen              no [libgen] pool entries");
  else
    await run(libgenSource({ mirrors: libgenMirrors }), ` via ${libgenMirrors.length} mirror(s)`);

  const annasMirrors = mirrorBaseUrls(list, "annas-archive");
  if (annasMirrors.length === 0) {
    console.log("skip annas-archive       no [annas-archive] pool entries");
  } else {
    await run(
      annasArchiveSource({ mirrors: annasMirrors }),
      ` via ${annasMirrors.length} mirror(s)`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} smoke failure(s)`);
  process.exitCode = 1;
}
