# Tolk Action

Use `randock/tolk-action@v1` to run the pinned Tolk CLI on a repository's own runner.
The E1 commands are `gate` (default), `refresh` and `scope-close`.
Gate publishes the required commit status `tolk/gate` on the PR head. Its
single comment contains the CLI message, committed drafts and translations,
missing texts and the branch link supplied by the engine. Fork PRs skip before
download and credential use. Waiting leaves the job green. The status is pending
for blocking waits and success for report-only waits.

## Install the CLI on macOS or Linux

Run this in a terminal on an Intel or Arm64 Mac, or on x86-64 or Arm64 Linux:

```sh
bash -o pipefail -c 'curl -fsSL https://raw.githubusercontent.com/randock/tolk-action/f7178c8d0abb31ccc12ab4d7f002beb37bdd1143/install.sh | sh'
```

The installer needs curl and either sha256sum or shasum. It verifies the signed
manifest and the platform binary for CLI v0.1.0, then installs it at
`$HOME/.local/bin/tolk`. Installation runs as your usual user. To put the CLI
on your PATH, add this line to `~/.zshrc` or `~/.bashrc` and run it in your
current shell:

```sh
export PATH="$HOME/.local/bin:$PATH"
tolk --help
```

## Install the Action

Copy the [two E1 workflow files](workflows/) to `.github/workflows/` and set
`TOLK_TOKEN` to the source's CI token. The customer CLI download uses no release
credential. Install your extractor's dependencies before running the Action.
Gate runs on PR changes, including a change of base. Main refreshes with the
previous 50 commits. Close checks out the default branch and reads its own run's
creation time, including on reruns. The templates grant each job its required
permissions. Automated text delivery arrives with E2.

Inputs and defaults are listed in [action.yml](action.yml). `levels` accepts
`en=none,nl=machine`. Set `on-waiting` to `fail` or `report` to override
the base policy, or `comment: false` to publish only the status and annotations.
Outputs are `verdict`, `rule`, JSON `levels` and the distinct ID count for each
answer (`not-pushed`, `behind`, `blocked`, `no-picture`, `not-pulled`, `waiting`).
An offline pass succeeds. If the judging call cannot reach the engine, the
Action publishes an error status. Protect the branch by requiring `tolk/gate`.

## Fixture setup

The E1 fixture and customer repositories use the same two workflows and the
same public CLI release. Configure the source-scoped `TOLK_TOKEN`. Release
assets are downloaded anonymously. The workflow's own GitHub token reports
the verdict, comment and annotations. The CLI reads the engine settings from
the checked-out configuration.

For a separately authorized private build, the installer can read a step-local
`TOLK_RELEASE_TOKEN` with Contents: read on `randock/tolk-action` only.
The shipped templates omit it. The installer sends this credential only to
the GitHub release API and verifies the same signature and checksums.

## Release

1. Build the CLI using the reviewed Tolk revision and its CLI release candidate
   workflow. Independently reproduce all six binaries and check their SHA-256
   values against the candidate manifest. Review and commit that manifest as
   `checksums/vX.Y.Z.txt` in this Action and pin its version in `action.yml`.
2. Follow the [Tolk CLI release procedure](https://github.com/randock/tolk#reproducing-a-cli-release)
   to sign the manifest on the approved immutable source tag in the private engine repository. The installer checks
   the pinned Cosign v3.1.4 verifier before use, verifies the complete manifest
   against the exact Tolk workflow and version tag with the GitHub Actions issuer,
   then checks the selected binary. Windows on Arm uses the x64 Cosign build
   under emulation and the native arm64 Tolk CLI. Both download routes require
   the signature bundle.
3. After independent review and green CI for the exact Action head, land the
   reviewed PR through the project’s release process. Independently verify the signed
   candidate and inspect the Action repository’s public contents before making
   this repository public. Create a draft GitHub release here at tag `cli-vX.Y.Z`
   on the reviewed revision. Upload the six raw binaries, `SHA256SUMS` and `SHA256SUMS.sigstore.json`
   from the verified build, and record both source revisions and the build run.
   Publish the draft after all eight assets are attached. Download them anonymously,
   verify the bundle and check every pinned digest. GitHub locks assets on publication
   for releases created since immutable releases were enabled. Supersede a bad
   release with a new version. Update the shell installer pins and its commit URL
   alongside the Action pins for each new CLI version.
4. Create the immutable Action release tag (initially `v1.0.0`). Verify the
   release through an authorized consuming repository before updating the
   floating `v1` tag to that same reviewed commit. Use an expected-old-SHA
   lease when moving an existing major tag.

Run `node --test` to exercise the installer, all gate states, annotations,
comment updates and branch deletion without credentials or a remote engine.

Run `node scripts/check-signature.mjs` to verify a published upstream test
manifest and exercise rejection with the real pinned verifier.
