# Release flow

This repo uses two long-lived branches:

- `dev`: day-to-day work lands here.
- `main`: released code only.

Merging `dev` into `main` releases the SDK. No other branch merge publishes to npm.

## Normal release steps

1. Work on feature branches and merge them into `dev`.
2. Open a PR from `dev` into `main`.
3. Choose the release size with a PR label:

   - no label: patch release, for example `0.4.0` -> `0.4.1`
   - `release:patch`: patch release
   - `release:minor`: minor release, for example `0.4.0` -> `0.5.0`
   - `release:major`: major release, for example `0.4.0` -> `1.0.0`

   Create these labels in GitHub once if they do not already exist. You can add, remove, or change the label after opening the PR; the workflow recalculates the version from `main`.

4. Wait for the `Prepare release version` workflow to commit the version bump to `dev`.
5. Wait for CI to pass on the bumped commit.
6. Merge the PR.

Do not bump `package.json` manually for normal releases. The release PR workflow calculates the next version from `main`, updates `package.json` and `package-lock.json`, and commits that change back to `dev`.

The release workflow then:

- installs dependencies
- checks that the package version is not already on npm
- checks that the matching Git tag does not already exist
- runs typecheck and tests
- publishes to npm
- creates a Git tag like `v0.5.0`
- creates a GitHub Release for that tag

## Required GitHub setup

Create a GitHub Environment named `npm-production`.

This environment does not need npm secrets. It is only used so GitHub can add deployment protection, for example a required reviewer before publishing.

On npmjs.com, configure Trusted Publishing for `@adtention/sdk`:

- Publisher: GitHub Actions
- Organization or user: `adtention-ai`
- Repository: `sdk-js`
- Workflow filename: `release.yml`
- Environment name: `npm-production`
- Allowed action: `npm publish`

No `NPM_TOKEN` is needed. npm uses GitHub's short-lived OIDC identity for this exact workflow instead of a long-lived access token.

The GitHub Release uses GitHub's built-in `GITHUB_TOKEN`, so no extra GitHub secret is needed.

After the first Trusted Publishing release works, npm recommends restricting token-based publishing for this package:

- package settings -> Publishing access
- select "Require two-factor authentication and disallow tokens"
- revoke old automation publish tokens if they are no longer used

Recommended branch rules:

- protect `main`
- require pull requests before merging
- require CI to pass before merging
- block direct pushes to `main`

Only require the CI checks as branch protection checks. Do not require `Prepare release version`, because that workflow may create the version-bump commit and then trigger CI for the new commit.

The `dev` branch should be created from the current `main` branch once this release flow is merged.
