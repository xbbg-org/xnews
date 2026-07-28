# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `bun run release <patch|minor|major|X.Y.Z>` cuts a release: it verifies the checkout is clean and synced, runs the quality and packaged-install gates, bumps the manifest, promotes `[Unreleased]` to a dated section with fresh compare links, commits, and writes an annotated tag whose message is the release notes. `--dry-run` validates without changing anything.
- `npm-publish.yml` now cuts the GitHub release from the matching `CHANGELOG.md` section, so the tag, the npm tarball, and the GitHub release notes cannot drift apart.

## [0.1.1] - 2026-07-28

### Changed

- Published by CI through npm trusted publishing (OIDC), so the tarball carries a provenance attestation. `0.1.0` was published from a maintainer token and has none.

## [0.1.0] - 2026-07-28

### Added

- Company, topic, and watchlist news feeds over 36 free, keyless public providers.
- SEC EDGAR company, current, and full-text filing sources; MSRB EMMA municipal continuing disclosures; Federal Register and CourtListener.
- 22 fixed market and wire feeds filtered locally against the subject.
- YouTube channel subscriptions, caption transcripts, and realtime audio transcription via local Moonshine or hosted OpenRouter backends.
- Injected `fetch`, `timeoutMs`, and `signal` support across every provider.
- Apache-2.0 `LICENSE` and full npm release metadata (`repository`, `homepage`, `bugs`, `keywords`, `author`, `engines`, `publishConfig`).
- `./package.json` subpath export so tooling can resolve the manifest through the package name.
- `npm-publish.yml` workflow publishing through npm trusted publishing (OIDC) with provenance attestation on `vX.Y.Z` tags.
- Packaging validation gates: `publint`, `@arethetypeswrong/cli`, and a `smoke:packaged-install` test that installs the packed tarball into a throwaway project and exercises the public entrypoint under plain Node.

### Fixed

- Published bundle now links its source map. `--sourcemap=external` emitted `dist/index.js.map` without a `sourceMappingURL` comment, shipping ~308 KB of unreachable data.
- Declaration maps no longer point at `../src`, which is not part of the published tarball; `declarationMap` is disabled for the build config.

[Unreleased]: https://github.com/xbbg-org/xnews/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/xbbg-org/xnews/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/xbbg-org/xnews/releases/tag/v0.1.0
