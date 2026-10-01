# Contributing

Fork the repo and branch from `main`, which is the only long-lived branch. Name the branch after what it does.

## Setup

We use [pnpm](https://pnpm.io) and the Node version in `.tool-versions`.

```bash
pnpm install
pnpm run prepare   # once: turns on the gitleaks pre-commit hook
```

New dependency versions must be at least 7 days old (`minimumReleaseAge` in `pnpm-workspace.yaml`). `@perawallet/connect` is the only exception. If `pnpm install` can't find a version you just asked for, that rule is why.

## Checks

CI runs all of these on every pull request:

```bash
pnpm lint           # oxlint
pnpm format:check   # oxfmt (use `pnpm format` to fix)
pnpm typecheck
pnpm test:coverage
pnpm build && pnpm exec publint
```

## Working against a local connect

To try an unreleased `@perawallet/connect`, point the dependency at your checkout:

```json
"@perawallet/connect": "file:../connect"
```

Don't commit that change.

## Secrets

Never commit a credential. This package is published to npm, so anything in the source ends up in a bundle anyone can read and in git history that cannot be rewritten away.

- **Locally**, a `pre-commit` hook scans staged changes with [gitleaks](https://github.com/gitleaks/gitleaks). `pnpm run prepare` turns it on by pointing `core.hooksPath` at `.githooks/`. `pnpm install` can't do this for you, because `.npmrc` sets `ignore-scripts`. If gitleaks isn't installed the hook warns and lets the commit through, so install it (`brew install gitleaks` on macOS).
- **In CI**, the pre-merge workflow scans the branch history and the release workflow scans the built bundle before publishing. These fail the build.

If a scan flags something that is genuinely not a secret, add a `// gitleaks:allow` comment on that line so the reason shows up in review.

## Commits and pull requests

Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/), for example `fix(adapter): map cancelled signing to 4001`. In the PR description, say what changed and how you checked it.

## Releasing

See [RELEASING.md](./RELEASING.md).
