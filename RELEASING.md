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
2. Settings → Environments: create `npm-publish` and add the release approvers as required reviewers.
3. Protect `main` and require the `pre-merge` checks to pass.
4. Turn on private vulnerability reporting under Settings → Code security.

## Each release

1. Bump the version in `package.json` in a PR:
   - for a beta, `pnpm version prerelease --preid beta --no-git-tag-version`
   - for a stable release, `pnpm version <x.y.z> --no-git-tag-version`
2. Bump `@perawallet/connect` too if the release should ship a newer connect. It is pinned to an exact version on purpose.
3. After the PR merges: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. Approve the `npm-publish` environment run when GitHub asks. Versions containing a `-` publish under the npm dist-tag named by their prerelease id (`1.0.0-beta.1` goes to `beta`). Clean versions go to `latest`.
5. Check the provenance badge on https://www.npmjs.com/package/@perawallet/use-wallet-pera.
