## Summary

<!-- What changes and why. Link the issue this closes. -->

## Type of change

- [ ] Bug fix
- [ ] New source / provider
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation only

## Verification

<!-- State what you actually ran, not what should pass. -->

- [ ] `bun run quality` passes
- [ ] `bun run smoke:packaged-install` passes (required for packaging or export changes)
- [ ] New/changed behavior is covered by tests that fail without the change
- [ ] Tests do not hit the network

## Checklist

- [ ] `CHANGELOG.md` `[Unreleased]` updated for user-visible changes
- [ ] README updated (source catalog table for new providers)
- [ ] Public API changes are exported from `src/index.ts`
- [ ] No new dependency on a paid or key-requiring endpoint
