# Contributing to xnews

Thanks for your interest in improving xnews.

## Scope

xnews is a pure fetch/parse/normalize library. It does not persist data, schedule jobs,
store state, score sentiment, or provide investment advice. Contributions that add
persistence, scheduling, or advisory behavior are out of scope; those belong in the
consuming application.

## Development setup

Install the Bun workspace once from the repository root:

```sh
bun install
bun run check
bun run test
```

The unqualified commands cover both the root `@xbbg/xnews` package and the
`packages/xnews-langgraph` companion. Use the scoped commands while working on one
package:

```sh
bun run check:core
bun run check:langgraph       # builds the local core first
bun run quality:core
bun run quality:langgraph     # resolves @xbbg/xnews from this checkout
```

Before opening a pull request, run the full workspace quality suite:

```sh
bun run quality
bun run smoke:packaged-install
```

The companion packaged-install smoke packs both local packages and runs consumer
projects with exactly Zod 3.25.76 and 4.2.0. A single compatibility case can be run
with `bun run --cwd packages/xnews-langgraph smoke:packaged-install -- 3.25.76`
or `-- 4.2.0`.

The companion's development-only `@xbbg/xnews` edge is `file:../..` because Bun's
`link:` protocol addresses globally registered package names rather than relative
folders. Published runtime resolution remains the `@xbbg/xnews` peer dependency; no
local-path specifier is allowed in runtime dependencies.

## Adding a source

Every provider follows the same shape, so keep to it rather than introducing a second
convention:

- Put the URL builder (`fooRssUrl`) in `src/sources/foo.urls.ts`. Its transitive
  imports must stay network-free; re-export it from `foo.ts` and `src/catalog.ts`.
- Keep the pure parser (`parseFooNews`) and fetcher (`fetchFooNews`) in `foo.ts`;
  fetchers go through `fetchText` with the injected `fetch`.
- Parsers must be pure and total: given fixture text they return `NewsItem[]` without
  network access, and malformed upstream content yields warnings rather than throwing.
- Register the provider in `src/feed.ts`, declare its capabilities, and export it from
  `src/index.ts`. Export its parser from `src/parsers.ts`.
- Add fixtures and tests under `test/`. Tests must not hit the network.
- Document the provider in the README source catalog table.
- Only free, keyless, public endpoints. Sources requiring paid plans or API keys, and
  endpoints that block non-browser clients, are excluded on purpose.

Verify against live endpoints separately with `bun run smoke:sources`. That script is a
manual check, not part of CI, because it depends on third-party availability.

## Commit and release

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Record core changes under `## [Unreleased]` in `CHANGELOG.md` and companion changes
  in `packages/xnews-langgraph/CHANGELOG.md`.
- Never run `npm publish` locally. Every publication, including the first companion
  publication, runs in `.github/workflows/npm-publish.yml`.
- Normal publishing uses npm trusted publishing (OIDC). The trusted-publishing path
  explicitly removes token environment variables, and no long-lived npm token belongs
  in ordinary release jobs.
- Do not add `sideEffects: false` to the core manifest. `bun build` can then tree-shake
  pure re-exported declarations such as `FIXED_FEEDS` out of the bundle while leaving
  them in the export list. The core packaged-install smoke catches this.

Releases are explicit about which independently versioned package is changing:

```sh
bun run release core patch
bun run release langgraph minor
bun run release core 1.2.3 --dry-run
bun run release langgraph 0.2.0 --push
```

The release command refuses a dirty tree, a branch other than `main`, a mismatch with
`origin/main`, or a duplicate package tag. It runs only the selected package's quality
and packaged-install gates, updates only its manifest and changelog, commits, and creates
an annotated tag. Core keeps `vX.Y.Z`; the companion uses
`xnews-langgraph-vX.Y.Z`.

Pushing either tag triggers `npm-publish.yml`. The workflow resolves package metadata
from an allowlist, requires the selected manifest name and version to match the tag,
publishes from that package directory, and creates release notes from that package's
changelog. Retries are idempotent.

Both packages share one version line: a companion release carries the same version as the
core release it is tested against, and its `@xbbg/xnews` peer range names that version.
Release the core first when both change, then the companion at the same version. The two
are still tagged, packed, gated, and published separately — the shared number is a
compatibility statement, not a monorepo-wide bump.

Both packages are published and configured for npm trusted publishing against this exact
workflow, so no npm token belongs in the repository. The `npm-publish` environment is
protected by required reviewers; a release waits for that approval before the publish job
runs. The `bootstrap` dispatch input exists only for a package that has never been
published, and it is rejected for core, tag-push events, non-`main` commits, existing
tags, or an existing package.

## License

By contributing, you agree that your contributions are licensed under the Apache License
2.0, as found in `LICENSE`.
