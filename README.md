# Tolk Action

Use `randock/tolk-action@v1` to run the pinned Tolk CLI on a repository's own runner.
The E1 commands are `gate` (default), `refresh` and `scope-close`.
Gate publishes the required commit status `tolk/gate` on the PR head. Its
single comment contains the CLI message, committed drafts and translations,
missing texts and the branch link supplied by the engine. Fork PRs skip before
download and credential use. Waiting leaves the job green. The status is pending
for blocking waits and success for report-only waits.

## Install

Copy the [three workflow templates](workflows/) to `.github/workflows/` and set
`TOLK_TOKEN` to the source's CI token. Install your extractor's dependencies
before running the Action. The templates include the E2 sync steps specified
in section 8.6. Until E2 is released, disable those steps and scheduled sync.
Gate requires contents read, pull requests write and statuses write. Refresh
needs a checkout with the previous 50 commits. Close reads the original workflow
run's creation time, including on reruns. In repositories with restricted
defaults, grant the close job `contents: read` and `actions: read`.

A private release requires an additional step environment variable:

```yaml
- uses: randock/tolk-action@v1
  env:
    TOLK_RELEASE_TOKEN: ${{ secrets.TOLK_RELEASE_TOKEN }}
  with:
    token: ${{ secrets.TOLK_TOKEN }}
```

Supply a release reader with **Contents: read** on **randock/tolk-action only**.
GitHub also implicitly grants metadata read. The installer requests only the
release and selected asset from that repository. The workflow token reports
the result to GitHub. The CLI receives the source-scoped Tolk token and reads
engine settings from the checked-out configuration. A customer repository's
workflow token is normally scoped to that repository. Configuring private
Action sharing is a separate owner decision. The organization scope allows
eligible repositories throughout the organization to use the Action.

Inputs and defaults are listed in [action.yml](action.yml). `levels` accepts
`en=none,nl=machine`. Set `on-waiting` to `fail` or `report` to override
the base policy, or `comment: false` to publish only the status and annotations.
Outputs are `verdict`, `rule`, JSON `levels` and the distinct ID count for each
answer (`not-pushed`, `behind`, `blocked`, `no-picture`, `not-pulled`, `waiting`).
An offline pass succeeds. If the judging call cannot reach the engine, the
Action publishes an error status. Protect the branch by requiring `tolk/gate`.

## Release

1. Build the CLI using the reviewed Tolk revision and its CLI release candidate
   workflow. Independently reproduce all six binaries and check their SHA-256
   values against the candidate manifest. Review and commit that manifest as
   `checksums/vX.Y.Z.txt` in this Action and pin its version in `action.yml`.
2. After independent review and green CI for the exact Action head, land the
   reviewed PR. Create a GitHub release in this repository at tag `cli-vX.Y.Z`
   on the reviewed revision. Upload the six raw binaries and `SHA256SUMS`
   from the verified build, and record both source revisions and the build run.
   Download the release again and verify every pinned digest. Existing version
   tags and their assets are immutable.
3. Create the immutable Action release tag (initially `v1.0.0`). Verify the
   release through an authorized consuming repository before updating the
   floating `v1` tag to that same reviewed commit. Use an expected-old-SHA
   lease when moving an existing major tag.

Run `node --test` to exercise the installer, all gate states, annotations,
comment updates and branch deletion without credentials or a remote engine.
