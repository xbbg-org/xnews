import { expect, test } from "bun:test";
import {
  assertManifestMatchesTag,
  release,
  RELEASE_PACKAGES,
  resolveReleasePackage,
} from "../scripts/release.js";
import type { ReleaseIo } from "../scripts/release.js";

const REPOSITORY = "https://github.com/xbbg-org/xnews";
const CORE_MANIFEST = `${JSON.stringify(
  {
    name: "@xbbg/xnews",
    version: "0.2.0",
    repository: { type: "git", url: `git+${REPOSITORY}.git` },
  },
  undefined,
  2,
)}\n`;
const LANGGRAPH_MANIFEST = `${JSON.stringify(
  {
    name: "@xbbg/xnews-langgraph",
    version: "0.1.0",
    repository: { type: "git", url: `git+${REPOSITORY}.git` },
  },
  undefined,
  2,
)}\n`;
const CORE_CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Core release notes.

## [0.2.0] - 2026-08-01

- Existing core release.

[Unreleased]: ${REPOSITORY}/compare/v0.2.0...HEAD
[0.2.0]: ${REPOSITORY}/releases/tag/v0.2.0
`;
const LANGGRAPH_CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Companion release notes.

## [0.1.0] - 2026-08-01

- Initial companion release.

[Unreleased]: ${REPOSITORY}/compare/xnews-langgraph-v0.1.0...HEAD
[0.1.0]: ${REPOSITORY}/releases/tag/xnews-langgraph-v0.1.0
`;

interface HarnessOptions {
  readonly status?: string;
  readonly local?: string;
  readonly remote?: string;
  readonly existingTag?: string;
}

interface RecordedCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly input?: string;
}

function createHarness(options: HarnessOptions = {}): {
  readonly io: ReleaseIo;
  readonly commands: RecordedCommand[];
  readonly streamed: RecordedCommand[];
  readonly writes: Map<string, string>;
} {
  const files: Record<string, string> = {
    "package.json": CORE_MANIFEST,
    "CHANGELOG.md": CORE_CHANGELOG,
    "packages/xnews-langgraph/package.json": LANGGRAPH_MANIFEST,
    "packages/xnews-langgraph/CHANGELOG.md": LANGGRAPH_CHANGELOG,
  };
  const commands: RecordedCommand[] = [];
  const streamed: RecordedCommand[] = [];
  const writes = new Map<string, string>();
  const local = options.local ?? "1111111111111111111111111111111111111111";
  const remote = options.remote ?? local;

  const io: ReleaseIo = {
    run(command, args, input) {
      commands.push({ command, args: [...args], ...(input === undefined ? {} : { input }) });
      const invocation = `${command} ${args.join(" ")}`;
      if (invocation === "git rev-parse --abbrev-ref HEAD") return "main";
      if (invocation === "git status --porcelain") return options.status ?? "";
      if (invocation === "git rev-parse HEAD") return local;
      if (invocation === "git rev-parse origin/main") return remote;
      if (invocation.startsWith("git tag --list ")) return options.existingTag ?? "";
      return "";
    },
    runStreaming(command, args) {
      streamed.push({ command, args: [...args] });
    },
    async readText(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`unexpected read: ${path}`);
      return text;
    },
    async writeText(path, contents) {
      writes.set(path, contents);
    },
    today() {
      return "2026-08-25";
    },
    log() {},
  };

  return { io, commands, streamed, writes };
}

async function rejectionError(promise: PromiseLike<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected promise to reject");
}

test("rejects an unknown release package before touching git", async () => {
  const harness = createHarness();
  const error = await rejectionError(release(["wrong", "patch"], harness.io));
  expect(error.message).toContain("unknown release package 'wrong'");
  expect(harness.commands).toEqual([]);
});

test("rejects a dirty tree", async () => {
  const harness = createHarness({ status: " M package.json" });
  const error = await rejectionError(release(["core", "patch"], harness.io));
  expect(error.message).toContain("working tree is dirty");
});

test("rejects a local and remote branch mismatch", async () => {
  const harness = createHarness({ remote: "2222222222222222222222222222222222222222" });
  const error = await rejectionError(release(["core", "patch"], harness.io));
  expect(error.message).toContain("HEAD (1111111) and origin/main (2222222) disagree");
});

test("rejects an existing package-specific tag", async () => {
  const harness = createHarness({ existingTag: "xnews-langgraph-v0.1.1" });
  const error = await rejectionError(release(["langgraph", "patch"], harness.io));
  expect(error.message).toContain("tag xnews-langgraph-v0.1.1 already exists");
});

test("manifest identity and version must match the selected tag", () => {
  expect(() =>
    assertManifestMatchesTag(
      RELEASE_PACKAGES.langgraph,
      { name: "@xbbg/xnews-langgraph", version: "0.1.1" },
      "xnews-langgraph-v0.1.2",
    ),
  ).toThrow("version (0.1.1) does not match tag (0.1.2)");
  expect(() =>
    assertManifestMatchesTag(
      RELEASE_PACKAGES.core,
      { name: "@xbbg/xnews-langgraph", version: "0.2.1" },
      "v0.2.1",
    ),
  ).toThrow("expected '@xbbg/xnews'");
});

test("companion release gates and stages only companion files", async () => {
  const harness = createHarness();
  expect(await release(["langgraph", "patch"], harness.io)).toBe(0);

  expect(harness.streamed).toEqual([
    { command: "bun", args: ["run", "quality:langgraph"] },
    { command: "bun", args: ["run", "smoke:packaged-install:langgraph"] },
  ]);
  expect([...harness.writes.keys()]).toEqual([
    "packages/xnews-langgraph/package.json",
    "packages/xnews-langgraph/CHANGELOG.md",
  ]);
  expect(harness.writes.get("packages/xnews-langgraph/CHANGELOG.md")).toContain(
    `[Unreleased]: ${REPOSITORY}/compare/xnews-langgraph-v0.1.1...HEAD`,
  );
  // The lockfile records the companion's version and peer ranges; a release commit without
  // it fails CI's frozen-lockfile install before anything is published.
  expect(harness.commands).toContainEqual({
    command: "bun",
    args: ["install", "--ignore-scripts"],
  });
  expect(harness.commands).toContainEqual({
    command: "git",
    args: [
      "add",
      "--",
      "packages/xnews-langgraph/package.json",
      "packages/xnews-langgraph/CHANGELOG.md",
      "bun.lock",
    ],
  });
  expect(harness.commands).toContainEqual({
    command: "git",
    args: ["tag", "-a", "xnews-langgraph-v0.1.1", "-F", "-"],
    input: expect.stringContaining("xnews LangGraph 0.1.1"),
  });
});

test("explicit core release preserves the v tag and core-only staging", async () => {
  const harness = createHarness();
  expect(await release(["core", "patch"], harness.io)).toBe(0);

  expect(harness.streamed).toEqual([
    { command: "bun", args: ["run", "quality:core"] },
    { command: "bun", args: ["run", "smoke:packaged-install:core"] },
  ]);
  expect([...harness.writes.keys()]).toEqual(["package.json", "CHANGELOG.md"]);
  expect(harness.commands).toContainEqual({
    command: "git",
    args: ["tag", "-a", "v0.2.1", "-F", "-"],
    input: expect.stringContaining("xnews 0.2.1"),
  });
  expect(resolveReleasePackage("core").packageName).toBe("@xbbg/xnews");
});
