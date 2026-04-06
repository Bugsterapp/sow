# GitHub Actions workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | push to `main`, PRs | Build + test on every change |
| `version-bump.yml` | manual (`workflow_dispatch`) | Bump versions in all three publishable packages, commit, and push a `vX.Y.Z` tag |
| `release.yml` | push of a `v*` tag | Build, test, verify, publish to npm in dependency order, and create a GitHub Release |
| `binaries.yml` | GitHub Release published | Build standalone CLI binaries for linux/darwin and attach them to the Release |

## How to cut a release

Standard path (recommended):

1. Open the **Actions** tab on GitHub.
2. Choose **Version Bump** -> **Run workflow**.
3. Pick the bump `level`: `patch`, `minor`, `major`, or `prerelease`.
   - For `prerelease`, you can override the identifier (default: `rc`). Example output: `0.2.0-rc.0`, `0.2.0-rc.1`, ...
4. The workflow will:
   - Compute the new version from `packages/core/package.json`.
   - Write it to all three packages (`core`, `cli`, `mcp`).
   - Commit `chore: bump version to vX.Y.Z` to `main`.
   - Push tag `vX.Y.Z`.
5. The tag push triggers `release.yml`, which builds, tests, publishes to npm, and creates the GitHub Release. `binaries.yml` then runs and uploads CLI binaries to the Release.

That's it. Don't touch version files by hand on `main`.

## Emergency: cut a release manually

If the Actions UI is unavailable, you can tag locally — but only after you've already bumped the version in all three `package.json` files via a normal PR:

```bash
git checkout main && git pull
# Edit packages/{core,cli,mcp}/package.json to the new version, commit, push
git tag v1.2.3
git push origin v1.2.3
```

`release.yml` will refuse to publish if the tag and the `package.json` versions don't match.

## Rollback

You **cannot** unpublish from npm (after the 72-hour window, and even within it you shouldn't). The recovery story is:

1. `npm deprecate @sowdb/core@1.2.3 "broken release, use 1.2.4"` (and the same for `@sowdb/cli` and `@sowdb/mcp`).
2. Fix forward: bump again via the Version Bump workflow and ship `1.2.4`.

If a release.yml run fails partway through (e.g. `@sowdb/core` published but `@sowdb/cli` failed), you can safely re-run the workflow on the same tag — it checks `npm view` for each package and skips the ones already published.

## What NOT to do

- Do **not** manually edit `version` in `packages/*/package.json` and push directly to `main`. The previous workflow auto-bumped on every push; the new workflow does not, so a manual bump without a tag will silently do nothing.
- Do **not** push a tag whose name doesn't match `v<MAJOR>.<MINOR>.<PATCH>(-prerelease)?`. `release.yml` validates the format and will fail loudly, but please don't rely on that.
- Do **not** commit `workspace:*` -> concrete-version rewrites back to `main`. The release workflow does that transformation in-memory at publish time only.

## Idempotency guarantees

- `release.yml` checks `npm view <pkg>@<version>` before publishing each package and skips already-published versions. Re-running on the same tag is safe.
- The GitHub Release creation step also no-ops if the release already exists.
- `version-bump.yml` aborts if the computed tag already exists locally.
