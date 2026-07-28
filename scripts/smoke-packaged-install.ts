/**
 * Packs the package exactly as npm would publish it, installs the tarball into a
 * throwaway project, and exercises the public entrypoint under plain Node.
 *
 * This catches the class of bug that unit tests structurally cannot see: a broken
 * `files` list, a missing runtime sidecar, an unresolvable subpath export, or an
 * artifact that only works because the source tree happens to sit next to it.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed (${String(result.status)})\n${detail}`);
  }
  return result.stdout ?? "";
}

const workspace = await mkdtemp(join(tmpdir(), "xnews-packed-"));
let failure: unknown;

try {
  console.log("packing tarball...");
  run("npm", ["pack", "--pack-destination", workspace], packageRoot);
  const tarball = (await readdir(workspace)).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack produced no tarball");
  console.log(`packed ${tarball}`);

  run("npm", ["init", "-y"], workspace);
  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify({ name: "xnews-packed-consumer", private: true, type: "module" }, null, 2)}\n`,
  );
  console.log("installing tarball into throwaway project...");
  run("npm", ["install", "--no-audit", "--no-fund", join(workspace, tarball)], workspace);

  // Consume through the package name so export maps are exercised, not file paths.
  const probe = join(workspace, "probe.mjs");
  await writeFile(
    probe,
    [
      `import { existsSync } from "node:fs";`,
      `import { createRequire } from "node:module";`,
      `import { fileURLToPath } from "node:url";`,
      `import {`,
      `  FIXED_FEED_PROVIDERS,`,
      `  buildCompanyNewsFeed,`,
      `  classifyMarketEvent,`,
      `  transcribeYoutubeRealtime,`,
      `  yahooFinanceRssUrl,`,
      `} from "@xbbg/xnews";`,
      ``,
      `const require = createRequire(import.meta.url);`,
      `const manifest = require("@xbbg/xnews/package.json");`,
      `if (manifest.name !== "@xbbg/xnews") throw new Error("./package.json export is broken");`,
      ``,
      `if (typeof buildCompanyNewsFeed !== "function") throw new Error("missing buildCompanyNewsFeed");`,
      `if (typeof transcribeYoutubeRealtime !== "function") throw new Error("missing transcribeYoutubeRealtime");`,
      `if (FIXED_FEED_PROVIDERS.length === 0) throw new Error("fixed feed registry is empty");`,
      ``,
      `const url = yahooFinanceRssUrl("RGA");`,
      `if (!url.startsWith("https://")) throw new Error("unexpected feed url: " + url);`,
      ``,
      `const classified = classifyMarketEvent({ title: "Acme declares quarterly dividend", url: "https://example.com/a" });`,
      `if (classified.eventKind !== "dividend") throw new Error("classifier regression: " + JSON.stringify(classified));`,
      ``,
      `// The Moonshine ASR backend resolves its Python worker relative to the built`,
      `// bundle, so it must be present inside the installed tarball.`,
      `const entry = fileURLToPath(import.meta.resolve("@xbbg/xnews"));`,
      `const worker = entry.replace(/index\\.js$/, "moonshine-worker.py");`,
      `if (!existsSync(worker)) throw new Error("moonshine sidecar missing from published package: " + worker);`,
      ``,
      `console.log("packaged install OK:", Object.keys(manifest.exports).join(", "));`,
    ].join("\n"),
  );

  console.log(run("node", [probe], workspace).trim());
  console.log("packaged-install smoke test passed");
} catch (error) {
  failure = error;
} finally {
  await rm(workspace, { force: true, recursive: true });
}

if (failure) {
  console.error(failure instanceof Error ? failure.message : JSON.stringify(failure));
  process.exitCode = 1;
}
