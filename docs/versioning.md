# Versioning policy

SiYuan Things uses semantic versions in the form `MAJOR.MINOR.PATCH`. Git tags add a `v` prefix, such as `v0.3.1`.

The versions in `package.json`, `plugin.json`, the Git tag, and the GitHub Release must match exactly.

## Current 0.x phase

Before `1.0.0`, choose the next version using these rules:

| Change type | Version bump | Example |
| --- | --- | --- |
| Bug, styling, or performance fixes and internal refactoring with no new user capability | Increment `PATCH` | `0.3.0 → 0.3.1` |
| Any user-visible feature, setting, interaction, or backward-compatible data capability | Increment `MINOR` and reset `PATCH` | `0.3.4 → 0.4.0` |
| Incompatible data, configuration, or interaction changes | Increment `MINOR` and document the migration or impact | `0.4.2 → 0.5.0` |
| Documentation, tests, or release tooling only, with no user release | No version bump | — |

When a release contains both features and fixes, use the higher-impact bump. Any new feature requires a `MINOR` bump rather than another `PATCH` release.

Using the current `v0.2.18` release as the baseline:

- Fixes only: release `v0.2.19`.
- Any new feature: release `v0.3.0`.
- Fixes after `v0.3.0`: release `v0.3.1`, `v0.3.2`, and so on.

## Moving to 1.0.0

Release `1.0.0` when the task, project, area, tag, and settings data models are stable; required migrations exist; the core workflow passes a full manual release check; documentation matches the product; and future compatibility can be stated clearly.

From `1.0.0` onward, follow SemVer strictly:

- `PATCH`: backward-compatible bug fixes.
- `MINOR`: backward-compatible features.
- `MAJOR`: incompatible data, configuration, API, or core interaction changes.

## Prereleases

Use `-beta.N` or `-rc.N` for public testing, for example `0.3.0-beta.1` or `0.3.0-rc.1`.

Only use prerelease tags after the release workflow can mark them as GitHub Prereleases and prevent them from becoming Latest or being indexed by the SiYuan Marketplace. Remove the suffix for the final release, such as `0.3.0-rc.2 → 0.3.0`.

## Changelog rules

- Group entries by calendar day, with only one heading per date even if several patch versions ship that day.
- Include the version or version range in the date heading.
- Separate user-facing entries into “Features” and “Bug fixes”, omitting empty categories.
- Record each change once and describe the user-visible outcome instead of implementation details.
- Clearly document the impact and migration path of incompatible changes.

## Release checklist

1. Select the version using this policy.
2. Update both `package.json` and `plugin.json`.
3. Update both READMEs, `CHANGELOG.md`, and relevant release documentation.
4. Run `npm test` and `npm run build`, then inspect `package.zip`.
5. Commit the changes and create the matching `v<version>` tag.
6. Push `main` and the tag, and confirm that GitHub Actions succeeds.
7. Confirm that the GitHub Release is the official Latest release and contains `package.zip`; the SiYuan Marketplace will index it asynchronously.
