/**
 * Reads and rewrites `CHANGELOG.md` as the single source of release notes.
 *
 * The GitHub release body, the annotated tag message, and the changelog section all
 * come from here, so one release cannot describe itself three different ways.
 *
 * CLI: `bun run ./scripts/changelog.ts section 1.2.3` prints that version's notes.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const CHANGELOG_PATH = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));

const SECTION_HEADING = /^## \[(?<label>[^\]]+)\](?: - (?<date>\d{4}-\d{2}-\d{2}))?\s*$/;
const LINK_REFERENCE = /^\[[^\]]+\]:\s*\S+\s*$/;

export interface ChangelogSection {
  readonly label: string;
  readonly date?: string;
  /** Index of the heading line within the source lines. */
  readonly start: number;
  /** Index one past the last line this section owns. */
  readonly end: number;
  readonly body: readonly string[];
}

export interface PromoteOptions {
  readonly version: string;
  readonly date: string;
  readonly previousVersion: string;
  readonly repositoryUrl: string;
  /** Prefix prepended to versions in compare links. Defaults to the core package's `v`. */
  readonly tagPrefix?: string;
}

function trimBlankEdges(lines: readonly string[]): string[] {
  let first = 0;
  let last = lines.length;
  while (first < last && lines[first]?.trim() === "") first += 1;
  while (last > first && lines[last - 1]?.trim() === "") last -= 1;
  return lines.slice(first, last);
}

/**
 * Splits the changelog into sections. Trailing link references belong to the
 * document rather than to the final section, so they never leak into notes.
 */
export function parseChangelog(text: string): {
  readonly lines: readonly string[];
  readonly sections: readonly ChangelogSection[];
} {
  const lines = text.split("\n");
  const headings: { label: string; date?: string; index: number }[] = [];

  for (const [index, line] of lines.entries()) {
    const groups = SECTION_HEADING.exec(line)?.groups;
    if (!groups) continue;
    const date = groups["date"];
    headings.push({ label: groups["label"] ?? "", ...(date === undefined ? {} : { date }), index });
  }

  const sections = headings.map((heading, position) => {
    const end = headings[position + 1]?.index ?? lines.length;
    const body = trimBlankEdges(
      lines.slice(heading.index + 1, end).filter((line) => !LINK_REFERENCE.test(line)),
    );
    return { ...heading, start: heading.index, end, body };
  });

  return { lines, sections };
}

export function findSection(text: string, label: string): ChangelogSection | undefined {
  return parseChangelog(text).sections.find((section) => section.label === label);
}

/** Release notes for a version, or `undefined` when that section has no entries. */
export function releaseNotes(text: string, version: string): string | undefined {
  const body = findSection(text, version)?.body;
  if (!body?.length) return undefined;
  return `${body.join("\n")}\n`;
}

/**
 * Promotes `## [Unreleased]` into a dated release section and repoints the compare
 * links. Throws when `[Unreleased]` is empty: a release that documents nothing is a
 * mistake, not something to paper over.
 */
export function promoteUnreleased(text: string, options: PromoteOptions): string {
  const { version, date, previousVersion, repositoryUrl, tagPrefix = "v" } = options;
  const { lines, sections } = parseChangelog(text);

  const unreleased = sections.find((section) => section.label === "Unreleased");
  if (!unreleased) throw new Error("CHANGELOG.md has no '## [Unreleased]' section");
  if (!unreleased.body.length) throw new Error("'## [Unreleased]' is empty; nothing to release");
  if (sections.some((section) => section.label === version)) {
    throw new Error(`CHANGELOG.md already documents ${version}`);
  }

  const promoted = [
    ...lines.slice(0, unreleased.start + 1),
    "",
    `## [${version}] - ${date}`,
    "",
    ...unreleased.body,
    "",
    ...lines.slice(unreleased.end),
  ];

  const linkIndex = promoted.findIndex((line) => line.startsWith("[Unreleased]:"));
  if (linkIndex === -1) throw new Error("CHANGELOG.md has no '[Unreleased]' link reference");

  promoted.splice(
    linkIndex,
    1,
    `[Unreleased]: ${repositoryUrl}/compare/${tagPrefix}${version}...HEAD`,
    `[${version}]: ${repositoryUrl}/compare/${tagPrefix}${previousVersion}...${tagPrefix}${version}`,
  );

  return promoted.join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, pathOrVersion, explicitVersion] = argv;
  const changelogPath = explicitVersion === undefined ? CHANGELOG_PATH : pathOrVersion;
  const version = explicitVersion ?? pathOrVersion;
  if (command !== "section" || !changelogPath || !version) {
    process.stderr.write("usage: changelog.ts section [changelog-path] <version>\n");
    return 2;
  }

  const notes = releaseNotes(await readFile(changelogPath, "utf8"), version);
  if (!notes) {
    process.stderr.write(`no changelog entries found for ${version}\n`);
    return 1;
  }

  process.stdout.write(notes);
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
