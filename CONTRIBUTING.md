# Contributing to xnews

Thanks for your interest in improving xnews.

## Scope

xnews is a pure fetch/parse/normalize library. It does not persist data, schedule jobs,
store state, score sentiment, or provide investment advice. Contributions that add
persistence, scheduling, or advisory behavior are out of scope; those belong in the
consuming application.

## Development setup

```sh
bun install
bun run check   # typecheck + lint + format:check
bun test
```

## Before opening a pull request

Run the full quality suite. It is the same gate CI enforces:

```sh
bun run quality
```

That runs typecheck, lint, format check, tests, build, `publint`, and
`@arethetypeswrong/cli`. To additionally verify the published artifact end to end:

```sh
bun run smoke:packaged-install
```

## Adding a source

Every provider follows the same shape, so keep to it rather than introducing a second
convention:

- A URL builder (`fooRssUrl`), a pure parser (`parseFooNews`), and a fetcher
  (`fetchFooNews`) that goes through `fetchText` with the injected `fetch`.
- Parsers must be pure and total: given fixture text they return `NewsItem[]` without
  network access, and malformed upstream content yields warnings rather than throwing.
- Register the provider in `src/feed.ts`, declare its capabilities, and export it from
  `src/index.ts`.
- Add fixtures and tests under `test/`. Tests must not hit the network.
- Document the provider in the README source catalog table.
- Only free, keyless, public endpoints. Sources requiring paid plans or API keys, and
  endpoints that block non-browser clients, are excluded on purpose.

Verify against live endpoints separately with `bun run smoke:sources`. That script is a
manual check, not part of CI, because it depends on third-party availability.

## Commit and release

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Record user-visible changes under `## [Unreleased]` in `CHANGELOG.md`.
- Releases are tag-driven: pushing a `vX.Y.Z` tag triggers `npm-publish.yml`, which
  refuses to publish if `package.json` disagrees with the tag. Bump the manifest version
  and move the `[Unreleased]` section before tagging.
- Publishing goes through npm trusted publishing (OIDC). The workflow holds no npm token
  and the registry only accepts publishes from `npm-publish.yml` on this repository, so
  no `NPM_TOKEN` secret should ever be added.
- Do not add `sideEffects: false` to `package.json`. `bun build` then tree-shakes pure
  re-exported declarations such as `FIXED_FEEDS` out of the bundle while leaving them in
  the export list, so the published tarball fails to link under Node.
  `bun run smoke:packaged-install` is what catches this.

## License

By contributing, you agree that your contributions are licensed under the Apache License
2.0, as found in `LICENSE`.
