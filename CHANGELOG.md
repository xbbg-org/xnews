# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

- `sec.gov` requests now fail closed with a `config` error unless `secUserAgent` or `userAgent` is set. SEC's fair-access policy requires a declared contact; the old `contact@example.com` default impersonated one.
- MSRB EMMA requests now require explicit `msrbAcceptTermsOfUse: true`. Accepting EMMA's Terms of Use is now the caller's recorded act.
- Transport failures now throw typed `XnewsFetchError` values with a machine-readable `code` (`config | network | http_status | timeout | aborted`). Provider warnings and errors include a credential- and sensitive-query-redacted effective URL.

### Added

- Added `./catalog`, `./parsers`, and `./asr` subpath exports. `@xbbg/xnews/catalog` is structurally network-free: its import graph never reaches the fetch layer.
- Added `parsePublishedAt` and `PUBLISHED_AT_PARSER_VERSION`. RSS/Atom and provider-native Finviz, GDELT, and EMMA dates now use one versioned derivation; invalid explicit dates fail closed, missing zones or offsets are read as UTC, and unknown formats are tagged `engine`.
- Added `ProviderResult.undatedExcluded` to report items dropped by a `since` or `until` window because they lack a parseable date.
- Added `ProviderError.code` and `SourceFetchOptions.redirect`; `"follow"` defaults to at most ten policy-checked hops while the injected fetch receives `"manual"` for each hop.
- `FIXED_FEEDS` entries now carry `suggestedMinPollSeconds`; new `PROVIDER_POLICIES` records capture per-provider operational facts, including SEC's 10 requests/second limit and declared-user-agent requirement and EMMA's terms; new `NEWS_ITEM_ID_SCHEME_VERSION` documents the `provider|guid-or-link|title` item ID derivation.
- `bun run release <patch|minor|major|X.Y.Z>` cuts a release: it verifies the checkout is clean and synced, runs the quality and packaged-install gates, bumps the manifest, promotes `[Unreleased]` to a dated section with fresh compare links, commits, and writes an annotated tag whose message is the release notes. `--dry-run` validates without changing anything.
- `npm-publish.yml` now cuts the GitHub release from the matching `CHANGELOG.md` section, so the tag, the npm tarball, and the GitHub release notes cannot drift apart.

### Changed

- Default User-Agent strings no longer embed the package version, which could drift.

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
