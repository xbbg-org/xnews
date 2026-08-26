/**
 * Cuts one independently versioned workspace release after package-specific gates.
 *
 * Tags are created locally because tags pushed with `GITHUB_TOKEN` do not trigger
 * other workflows. Publishing itself always happens in `npm-publish.yml`.
 *
 * usage: bun run release <core|langgraph> <patch|minor|major|X.Y.Z> [--push|--dry-run]
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promoteUnreleased, releaseNotes } from "./changelog.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const STABLE_SEMVER = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;
const RELEASE_BRANCH = "main";

export type ReleasePackageId = "core" | "langgraph";

interface ReleaseCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface ReleasePackage {
  readonly id: ReleasePackageId;
  readonly directory: string;
  readonly manifestPath: string;
  readonly changelogPath: string;
  readonly qualityCommand: ReleaseCommand;
  readonly smokeCommand: ReleaseCommand;
  readonly tagPrefix: string;
  readonly packageName: string;
  readonly releaseTitle: string;
}

export const RELEASE_PACKAGES: Readonly<Record<ReleasePackageId, ReleasePackage>> = {
  core: {
    id: "core",
    directory: ".",
    manifestPath: "package.json",
    changelogPath: "CHANGELOG.md",
    qualityCommand: { command: "bun", args: ["run", "quality:core"] },
    smokeCommand: { command: "bun", args: ["run", "smoke:packaged-install:core"] },
    tagPrefix: "v",
    packageName: "@xbbg/xnews",
    releaseTitle: "xnews",
  },
  langgraph: {
    id: "langgraph",
    directory: "packages/xnews-langgraph",
    manifestPath: "packages/xnews-langgraph/package.json",
    changelogPath: "packages/xnews-langgraph/CHANGELOG.md",
    qualityCommand: { command: "bun", args: ["run", "quality:langgraph"] },
    smokeCommand: { command: "bun", args: ["run", "smoke:packaged-install:langgraph"] },
    tagPrefix: "xnews-langgraph-v",
    packageName: "@xbbg/xnews-langgraph",
    releaseTitle: "xnews LangGraph",
  },
};

export interface ReleaseIo {
  readonly run: (command: string, args: readonly string[], input?: string) => string;
  readonly runStreaming: (command: string, args: readonly string[]) => void;
  readonly readText: (path: string) => Promise<string>;
  readonly writeText: (path: string, contents: string) => Promise<void>;
  readonly today: () => string;
  readonly log: (message: string) => void;
}

/** Reads a field out of parsed JSON without trusting the manifest's shape. */
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

const DEFAULT_IO: ReleaseIo = {
  run,
  runStreaming,
  readText: async (path) => readFile(resolve(packageRoot, path), "utf8"),
  writeText: async (path, contents) => writeFile(resolve(packageRoot, path), contents),
  today: () => new Date().toISOString().slice(0, 10),
  log: console.log,
};

export function resolveReleasePackage(id: string): ReleasePackage {
  if (id === "core" || id === "langgraph") return RELEASE_PACKAGES[id];
  throw new Error(`unknown release package '${id}'; expected core or langgraph`);
}

export function nextVersion(current: string, target: string): string {
  if (STABLE_SEMVER.test(target)) return target;

  const groups = STABLE_SEMVER.exec(current)?.groups;
  if (!groups) throw new Error(`manifest version '${current}' is not stable semver`);
  const major = Number(groups["major"]);
  const minor = Number(groups["minor"]);
  const patch = Number(groups["patch"]);

  if (target === "major") return `${String(major + 1)}.0.0`;
  if (target === "minor") return `${String(major)}.${String(minor + 1)}.0`;
  if (target === "patch") return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
  throw new Error(`unknown bump '${target}'; expected patch, minor, major, or X.Y.Z`);
}

export function tagForVersion(releasePackage: ReleasePackage, version: string): string {
  if (!STABLE_SEMVER.test(version)) throw new Error(`version '${version}' is not stable semver`);
  return `${releasePackage.tagPrefix}${version}`;
}

export function versionFromTag(releasePackage: ReleasePackage, tag: string): string {
  if (!tag.startsWith(releasePackage.tagPrefix)) {
    throw new Error(`tag '${tag}' does not select ${releasePackage.id}`);
  }
  const version = tag.slice(releasePackage.tagPrefix.length);
  if (!STABLE_SEMVER.test(version)) {
    throw new Error(`tag '${tag}' is not a stable ${releasePackage.id} release tag`);
  }
  return version;
}

export function assertManifestMatchesTag(
  releasePackage: ReleasePackage,
  manifest: unknown,
  tag: string,
): void {
  const name = jsonString(manifest, "name");
  if (name !== releasePackage.packageName) {
    throw new Error(
      `${releasePackage.manifestPath} names '${name ?? "<missing>"}', expected '${releasePackage.packageName}'`,
    );
  }
  const manifestVersion = jsonString(manifest, "version");
  const tagVersion = versionFromTag(releasePackage, tag);
  if (manifestVersion !== tagVersion) {
    throw new Error(
      `${releasePackage.manifestPath} version (${manifestVersion ?? "<missing>"}) does not match tag (${tagVersion})`,
    );
  }
}

function repositoryUrl(manifest: unknown, manifestPath: string): string {
  const declared = jsonString(jsonField(manifest, "repository"), "url") ?? "";
  const cleaned = declared.replace(/^git\+/, "").replace(/\.git$/, "");
  if (!cleaned.startsWith("https://")) {
    throw new Error(`${manifestPath} repository.url must be an https URL`);
  }
  return cleaned;
}

/** Refuses to release from a checkout a reviewer could not reproduce. */
function preflight(io: ReleaseIo): void {
  const branch = io.run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== RELEASE_BRANCH) {
    throw new Error(`releases are cut from ${RELEASE_BRANCH}; this checkout is on ${branch}`);
  }
  if (io.run("git", ["status", "--porcelain"]) !== "") {
    throw new Error("working tree is dirty; commit or stash before releasing");
  }

  io.run("git", ["fetch", "--tags", "origin", RELEASE_BRANCH]);
  const local = io.run("git", ["rev-parse", "HEAD"]);
  const remote = io.run("git", ["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if (local !== remote) {
    throw new Error(
      `HEAD (${local.slice(0, 7)}) and origin/${RELEASE_BRANCH} (${remote.slice(0, 7)}) disagree; ` +
        "pull or push before releasing",
    );
  }
}

export async function release(
  argv: readonly string[],
  io: ReleaseIo = DEFAULT_IO,
): Promise<number> {
  const flags = argv.filter((argument) => argument.startsWith("--"));
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  for (const flag of flags) {
    if (flag !== "--dry-run" && flag !== "--push") throw new Error(`unknown flag '${flag}'`);
  }
  if (positional.length !== 2) {
    process.stderr.write(
      "usage: bun run release <core|langgraph> <patch|minor|major|X.Y.Z> [--push|--dry-run]\n",
    );
    return 2;
  }

  const packageId = positional[0];
  const target = positional[1];
  if (!packageId || !target) return 2;
  const releasePackage = resolveReleasePackage(packageId);
  const dryRun = flags.includes("--dry-run");
  const push = flags.includes("--push");

  preflight(io);

  const manifestText = await io.readText(releasePackage.manifestPath);
  const manifest: unknown = JSON.parse(manifestText);
  const manifestName = jsonString(manifest, "name");
  if (manifestName !== releasePackage.packageName) {
    throw new Error(
      `${releasePackage.manifestPath} names '${manifestName ?? "<missing>"}', expected '${releasePackage.packageName}'`,
    );
  }
  const previousVersion = jsonString(manifest, "version");
  if (!previousVersion) throw new Error(`${releasePackage.manifestPath} has no version string`);
  const version = nextVersion(previousVersion, target);
  if (version === previousVersion) throw new Error(`already at ${version}`);
  const tag = tagForVersion(releasePackage, version);
  if (io.run("git", ["tag", "--list", tag]) !== "") {
    throw new Error(`tag ${tag} already exists`);
  }

  const changelogText = await io.readText(releasePackage.changelogPath);
  const promoted = promoteUnreleased(changelogText, {
    version,
    date: io.today(),
    previousVersion,
    repositoryUrl: repositoryUrl(manifest, releasePackage.manifestPath),
    tagPrefix: releasePackage.tagPrefix,
  });
  const notes = releaseNotes(promoted, version);
  if (!notes) throw new Error(`promoted changelog has no notes for ${version}`);

  io.log(`validating ${releasePackage.packageName} ${previousVersion} -> ${version}`);
  io.runStreaming(releasePackage.qualityCommand.command, releasePackage.qualityCommand.args);
  io.runStreaming(releasePackage.smokeCommand.command, releasePackage.smokeCommand.args);

  if (dryRun) {
    io.log(`\n--- dry run: would release ${tag} ---\n${notes}`);
    io.log(
      `would commit ${releasePackage.manifestPath} + ${releasePackage.changelogPath}, then tag ${tag}`,
    );
    return 0;
  }

  const updatedManifest = manifestText.replace(
    /(^\s*"version":\s*")[^"]+("\s*,?)/m,
    `$1${version}$2`,
  );
  if (updatedManifest === manifestText) {
    throw new Error(`could not rewrite the version field in ${releasePackage.manifestPath}`);
  }

  await io.writeText(releasePackage.manifestPath, updatedManifest);
  await io.writeText(releasePackage.changelogPath, promoted);

  io.run("git", ["add", "--", releasePackage.manifestPath, releasePackage.changelogPath]);
  const commitSubject =
    releasePackage.id === "core"
      ? `chore(release): ${version}`
      : `chore(release): xnews-langgraph ${version}`;
  io.run("git", ["commit", "-F", "-"], `${commitSubject}\n\n${notes}`);
  io.run(
    "git",
    ["tag", "-a", tag, "-F", "-"],
    `${releasePackage.releaseTitle} ${version}\n\n${notes}`,
  );
  io.log(`committed and tagged ${tag}`);

  if (!push) {
    io.log(
      `\nnot pushed. To release:\n  git push origin ${RELEASE_BRANCH}\n  git push origin ${tag}`,
    );
    return 0;
  }

  io.run("git", ["push", "origin", RELEASE_BRANCH]);
  io.run("git", ["push", "origin", tag]);
  io.log(`pushed ${tag}; npm-publish.yml publishes to npm and cuts the GitHub release`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await release(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
