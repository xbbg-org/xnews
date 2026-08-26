import { readFile } from "node:fs/promises";
import { expect, test } from "bun:test";
import {
  CHANGELOG_PATH,
  findSection,
  parseChangelog,
  promoteUnreleased,
  releaseNotes,
} from "../scripts/changelog.js";

const REPOSITORY_URL = "https://github.com/xbbg-org/xnews";

const CHANGELOG = `# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- A new provider.

### Fixed

- A parsing bug.

## [0.2.0] - 2026-01-02

### Added

- An older thing.

[Unreleased]: ${REPOSITORY_URL}/compare/v0.2.0...HEAD
[0.2.0]: ${REPOSITORY_URL}/releases/tag/v0.2.0
`;

const EMPTY_UNRELEASED = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-01-02

### Added

- An older thing.

[Unreleased]: ${REPOSITORY_URL}/compare/v0.2.0...HEAD
[0.2.0]: ${REPOSITORY_URL}/releases/tag/v0.2.0
`;

function promote(text: string, version: string, previousVersion = "0.2.0"): string {
  return promoteUnreleased(text, {
    version,
    date: "2026-03-04",
    previousVersion,
    repositoryUrl: REPOSITORY_URL,
  });
}

test("promotes Unreleased into a dated section and empties Unreleased", () => {
  const promoted = promote(CHANGELOG, "0.3.0");

  expect(promoted).toContain("## [0.3.0] - 2026-03-04");
  expect(findSection(promoted, "Unreleased")?.body).toEqual([]);
  expect(releaseNotes(promoted, "0.3.0")).toBe(
    "### Added\n\n- A new provider.\n\n### Fixed\n\n- A parsing bug.\n",
  );
});

test("repoints the Unreleased compare link and adds the release link below it", () => {
  const lines = promote(CHANGELOG, "0.3.0").split("\n");
  const unreleased = lines.indexOf(`[Unreleased]: ${REPOSITORY_URL}/compare/v0.3.0...HEAD`);

  expect(unreleased).toBeGreaterThan(-1);
  expect(lines[unreleased + 1]).toBe(`[0.3.0]: ${REPOSITORY_URL}/compare/v0.2.0...v0.3.0`);
  expect(lines).not.toContain(`[Unreleased]: ${REPOSITORY_URL}/compare/v0.2.0...HEAD`);
});

test("leaves already-released sections untouched", () => {
  const promoted = promote(CHANGELOG, "0.3.0");

  expect(promoted).toContain("## [0.2.0] - 2026-01-02");
  expect(releaseNotes(promoted, "0.2.0")).toBe("### Added\n\n- An older thing.\n");
});

test("keeps trailing link references out of the final section's notes", () => {
  // Link references sit inside the last section's line range, so only the
  // reference filter keeps them from being published as release notes.
  const notes = releaseNotes(CHANGELOG, "0.2.0") ?? "";

  expect(notes).toBe("### Added\n\n- An older thing.\n");
  expect(notes).not.toContain("[0.2.0]:");
});

test("refuses to release an empty Unreleased section", () => {
  expect(() => promote(EMPTY_UNRELEASED, "0.3.0")).toThrow(/nothing to release/);
  expect(releaseNotes(EMPTY_UNRELEASED, "Unreleased")).toBeUndefined();
});

test("refuses to promote a version the changelog already documents", () => {
  expect(() => promote(CHANGELOG, "0.2.0")).toThrow(/already documents 0\.2\.0/);
});

test("reports no notes for a version that is absent", () => {
  expect(releaseNotes(CHANGELOG, "9.9.9")).toBeUndefined();
});

test("uses a package-specific tag prefix in companion compare links", () => {
  const promoted = promoteUnreleased(CHANGELOG, {
    version: "0.3.0",
    date: "2026-03-04",
    previousVersion: "0.2.0",
    repositoryUrl: REPOSITORY_URL,
    tagPrefix: "xnews-langgraph-v",
  });

  expect(promoted).toContain(
    `[Unreleased]: ${REPOSITORY_URL}/compare/xnews-langgraph-v0.3.0...HEAD`,
  );
  expect(promoted).toContain(
    `[0.3.0]: ${REPOSITORY_URL}/compare/xnews-langgraph-v0.2.0...xnews-langgraph-v0.3.0`,
  );
});

test("parses the real CHANGELOG.md without leaking link references into any section", async () => {
  const text = await readFile(CHANGELOG_PATH, "utf8");
  const { sections } = parseChangelog(text);

  expect(sections.map((section) => section.label)).toContain("Unreleased");
  expect(sections.length).toBeGreaterThan(1);
  for (const section of sections) {
    expect(section.body.filter((line) => /^\[[^\]]+\]:\s*\S+$/.test(line))).toEqual([]);
  }
});

test("dates every released section so release notes are attributable", async () => {
  const text = await readFile(CHANGELOG_PATH, "utf8");
  const { sections } = parseChangelog(text);

  for (const section of sections) {
    if (section.label === "Unreleased") continue;
    expect(section.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});
