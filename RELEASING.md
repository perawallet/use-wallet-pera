# Releasing @perawallet/use-wallet-pera

## One-time npm setup (needs an npm org owner)

1. Publishing a new package name for the first time can't go through a trusted publisher. Do the first `npm publish --access public --tag beta` locally, from an npm account with 2FA, then straight away:
2. On npmjs.com, go to the package settings, then **Trusted Publisher**:
   - Provider: GitHub Actions
   - Organization/user: `perawallet`
   - Repository: `use-wallet-pera`
   - Workflow filename: `release.yml`
   - Environment: `npm-publish`
3. Under **Publishing access**, require two-factor authentication and disallow tokens, so only the trusted publisher can publish.

## One-time GitHub setup

1. The repository must be public. That's a use-wallet listing requirement, and npm only accepts provenance from public repositories.
2. Settings → Environments: create `npm-publish`, add the release approvers as required reviewers, and limit deployments to tags matching `v*`. Create it before the first release: a workflow that references a missing environment creates it with no protection rules.
3. Settings → Rules: add a tag ruleset that limits who can create, update or delete `v*` tags.
4. Protect `main` and require the `pre-merge` checks to pass.
5. Turn on private vulnerability reporting under Settings → Code security.

## Each release

1. Bump the version in `package.json` in a PR:
   - for a beta, `pnpm version prerelease --preid beta --no-git-tag-version`
   - for a stable release, `pnpm version <x.y.z> --no-git-tag-version`
2. Bump `@perawallet/connect` too if the release should ship a newer connect. It is pinned to an exact version on purpose.
3. After the PR merges: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `build` job checks that the tagged commit is on `main`, runs every check and packs the tarball. Approve the `publish` job when GitHub asks; it publishes that tarball and runs nothing else. Versions containing a `-` publish under the npm dist-tag named by their prerelease id (`1.0.0-beta.1` goes to `beta`). Clean versions go to `latest`.
5. Check the provenance badge on https://www.npmjs.com/package/@perawallet/use-wallet-pera.
