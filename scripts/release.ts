/**
 * Cuts a release: verifies the checkout, bumps the manifest, promotes the changelog,
 * commits, and tags.
 *
 * The tag is created locally on purpose. A tag pushed by CI with `GITHUB_TOKEN` does
 * not trigger other workflows, so a bot-driven bump would silently never publish.
 * Pushing the tag from a real checkout is what fires `npm-publish.yml`, which then
 * publishes to npm over OIDC and cuts the GitHub release.
 *
 * usage: bun run release <patch|minor|major|X.Y.Z> [--push] [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CHANGELOG_PATH, promoteUnreleased, releaseNotes } from "./changelog.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const STABLE_SEMVER = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;
const RELEASE_BRANCH = "main";

/**
 * Reads a field out of parsed JSON without asserting a shape onto it. The manifest
 * is data on disk, not a type we control, so it gets validated rather than trusted.
 */
function jsonField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  return Reflect.get(value, key);
}

function jsonString(value: unknown, key: string): string | undefined {
  const field: unknown = jsonField(value, key);
  return typeof field === "string" ? field : undefined;
}

function run(command: string, args: readonly string[], input?: string): string {
  const result = spawnSync(command, [...args], {
    cwd: packageRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    ...(input === undefined ? {} : { input }),
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed (${String(result.status)})\n${detail}`);
  }
  return (result.stdout ?? "").trim();
}

function runStreaming(command: string, args: readonly string[]): void {
  const result = spawnSync(command, [...args], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${String(result.status)})`);
  }
}

/** Refuses to release from a checkout a reviewer could not reproduce. */
function preflight(): void {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== RELEASE_BRANCH) {
    throw new Error(`releases are cut from ${RELEASE_BRANCH}; this checkout is on ${branch}`);
  }
  if (run("git", ["status", "--porcelain"]) !== "") {
    throw new Error("working tree is dirty; commit or stash before releasing");
  }

  run("git", ["fetch", "--tags", "origin", RELEASE_BRANCH]);
  const local = run("git", ["rev-parse", "HEAD"]);
  const remote = run("git", ["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if (local !== remote) {
    throw new Error(
      `HEAD (${local.slice(0, 7)}) and origin/${RELEASE_BRANCH} (${remote.slice(0, 7)}) disagree; ` +
        "pull or push before releasing",
    );
  }
}

function nextVersion(current: string, target: string): string {
  if (STABLE_SEMVER.test(target)) return target;

  const groups = STABLE_SEMVER.exec(current)?.groups;
  if (!groups) throw new Error(`package.json version '${current}' is not stable semver`);
  const major = Number(groups["major"]);
  const minor = Number(groups["minor"]);
  const patch = Number(groups["patch"]);

  if (target === "major") return `${String(major + 1)}.0.0`;
  if (target === "minor") return `${String(major)}.${String(minor + 1)}.0`;
  if (target === "patch") return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
  throw new Error(`unknown bump '${target}'; expected patch, minor, major, or X.Y.Z`);
}

function repositoryUrl(manifest: unknown): string {
  const declared = jsonString(jsonField(manifest, "repository"), "url") ?? "";
  const cleaned = declared.replace(/^git\+/, "").replace(/\.git$/, "");
  if (!cleaned.startsWith("https://")) {
    throw new Error("package.json repository.url must be an https URL");
  }
  return cleaned;
}

async function main(argv: readonly string[]): Promise<number> {
  const flags = new Set(argv.filter((argument) => argument.startsWith("--")));
  const target = argv.find((argument) => !argument.startsWith("--"));
  const dryRun = flags.has("--dry-run");
  const push = flags.has("--push");

  if (!target) {
    process.stderr.write("usage: bun run release <patch|minor|major|X.Y.Z> [--push] [--dry-run]\n");
    return 2;
  }

  preflight();

  const manifestText = await readFile(MANIFEST_PATH, "utf8");
  const manifest: unknown = JSON.parse(manifestText);
  const previousVersion = jsonString(manifest, "version");
  if (!previousVersion) throw new Error("package.json has no version string");
  const version = nextVersion(previousVersion, target);
  if (version === previousVersion) throw new Error(`already at ${version}`);
  if (run("git", ["tag", "--list", `v${version}`]) !== "") {
    throw new Error(`tag v${version} already exists`);
  }

  const changelogText = await readFile(CHANGELOG_PATH, "utf8");
  const promoted = promoteUnreleased(changelogText, {
    version,
    date: new Date().toISOString().slice(0, 10),
    previousVersion,
    repositoryUrl: repositoryUrl(manifest),
  });
  const notes = releaseNotes(promoted, version);
  if (!notes) throw new Error(`promoted changelog has no notes for ${version}`);

  // Never tag something the packaging gates have not seen. `quality` omits
  // smoke:packaged-install, the only check that installs the real tarball.
  console.log(`validating ${previousVersion} -> ${version}`);
  runStreaming("bun", ["run", "quality"]);
  runStreaming("bun", ["run", "smoke:packaged-install"]);

  if (dryRun) {
    console.log(`\n--- dry run: would release v${version} ---\n${notes}`);
    console.log(`would commit package.json + CHANGELOG.md, then tag v${version}`);
    return 0;
  }

  const updatedManifest = manifestText.replace(/(^\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
  if (updatedManifest === manifestText) {
    throw new Error("could not rewrite the version field in package.json");
  }

  await writeFile(MANIFEST_PATH, updatedManifest);
  await writeFile(CHANGELOG_PATH, promoted);

  run("git", ["add", "package.json", "CHANGELOG.md"]);
  run("git", ["commit", "-F", "-"], `chore(release): ${version}\n\n${notes}`);
  run("git", ["tag", "-a", `v${version}`, "-F", "-"], `xnews ${version}\n\n${notes}`);
  console.log(`committed and tagged v${version}`);

  if (!push) {
    console.log(
      `\nnot pushed. To release:\n  git push origin ${RELEASE_BRANCH}\n  git push origin v${version}`,
    );
    return 0;
  }

  run("git", ["push", "origin", RELEASE_BRANCH]);
  run("git", ["push", "origin", `v${version}`]);
  console.log(`pushed v${version}; npm-publish.yml publishes to npm and cuts the GitHub release`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
