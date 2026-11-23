# Connect your first repository

Tolk E1 links the IDs in your code to the drafts and language catalogues you commit. You can import existing translations, check a pull request and deliver catalogue changes. Your application reads the committed files and shows the draft wherever a language has no text for the current key.

## Install the signed CLI

On macOS or Linux (x86-64 or Arm64), use Bash, curl and either `shasum` or `sha256sum`. Run the pinned installer as your usual user:

```sh
bash -o pipefail -c 'curl -fsSL https://raw.githubusercontent.com/randock/tolk-action/f7178c8d0abb31ccc12ab4d7f002beb37bdd1143/install.sh | sh'
export PATH="$HOME/.local/bin:$PATH"
tolk --help
```

Add the export line to your shell profile for future terminals. The installer checks the pinned verifier and manifest, verifies the release workflow’s signature, and checks the binary against the signed manifest before installing it. Downloads are public. Windows x64 and Arm64 binaries, the signature bundle and verification details are on the [CLI v0.1.0 release](https://github.com/randock/tolk-action/releases/tag/cli-v0.1.0).

## Set up the project and credentials

1. Sign in to your Tolk web application with an email code or GitHub. Create an organisation and project. Choose the draft language and every language you will import, including any language you already ship.
2. **Set the vocabulary before import.** Compare the kinds, attributes, values and variant axes in your extractor output with the project vocabulary. New projects start with kinds and no attributes. For example, if `forms.variant` is `audience` and the texts have `guide` and `walker` forms, create the `audience` attribute, add both values and mark it as a variant. Confirm this in Settings. Importing a catalogue does not create vocabulary. A refusal that explicitly names *every* unknown attribute or value is an E2 requirement. E1 may report a forms error or miss an unknown attribute.
3. Add your repository as a source. For a one-token import and pull, choose **Author + Admin** when your deployment offers it. The default expiry is 24 hours. You can select a different future expiry or explicitly choose no expiry. Save the credential when it is shown and have your secret manager expose it to your local shell as `TOLK_TOKEN`. For a source with separate credentials, use temporary Admin for import and Author for pull and push.
4. Use a separate **CI** token for the source’s GitHub Actions secret named `TOLK_TOKEN`. Use **Author** for daily work. After verifying the import and pull, revoke the setup credential in Settings. Changing a grant requires issuing a new token. The CLI reads the token only from the environment.

## Prepare the checkout

Start on an introducing branch with Git installed and the target branch and its history fetched. Save the setup-generated `tolk.yaml` at the repository root. Use your own engine URL, project and source slugs. Set `extractor`, `sources`, `catalogue`, `drafts` and `project_copy` to paths that match **your repository**. Setup commonly uses `i18n/{language}.jsonl`. The worked example below uses `i18n/catalogue/{language}.jsonl`. Use the corresponding paths throughout.

Your repository supplies the extractor and the application’s catalogue reader. Install the extractor runtime and its dependencies locally and in the gate and refresh jobs before the Action. For a Node extractor with a package lock, provision the required Node version and run `npm ci` in the directory containing the lockfile. The extractor reads from `TOLK_SOURCE_ROOT` when the CLI sets it for historical checks. A small example and the output format are in the [repository reference](repository-reference.md#extractor-and-manifest).

Run `tolk init` with the configured source credential. It creates missing files, including the project copy, drafts, per-language catalogues and Git union-merge attributes. Put a stable ID and description at each use in code, and one draft per ID in the drafts file. Use synthetic content and placeholder examples. Copy the [gate and refresh workflow](../workflows/i18n.yml) and the [branch deletion workflow](../workflows/i18n-close.yml) into `.github/workflows/`. Adjust the push branch if your base is different from `main`.

## Import existing translations

Skip this section for an application starting with drafts only. For an existing application, keep a copy of the original catalogues so you can verify the result. Prepare a JSON Lines file per language. Set the drafts to the original draft-language values. Import can create a **missing** drafts file from the draft-language input. An **existing empty** file from init must be populated first.

From the repository root, with the local Author + Admin or Admin credential loaded, run:

```sh
tolk import --texts en=i18n/catalogue/en.jsonl:supplied \
  --texts nl=i18n/catalogue/nl.jsonl:supplied
```

Read the entire worker report before pulling. Check the imported, kept and changed key counts, texts written, and each refused ID, language and rule. A job can finish with some texts accepted and others refused. **Stop here on a failed job, any refusal, or an unexpected count.** Pulling now can remove a line for a missing text.

- For a forms refusal, check the project’s variant flag, all allowed values, the manifest axis and the forms in each affected language. Correct the vocabulary in Settings or the source inputs as appropriate. For other rules, fix the reported input, such as a missing placeholder. Preserve the original files.
- Rerun the same import with the corrected inputs. Identical keys are kept and missing language texts can be filled. Existing texts are preserved. A changed key is reported as changed and gets no text from reimport. Resolve an unintended draft or description change before retrying. Use an author push for an intentional new key.
- Continue when the report accounts for every intended key and language and shows zero refusals. If you used Admin alone, switch to Author now. With Author + Admin, keep the same token. Run `tolk pull --all` and compare the resulting language files with the intended originals. For an unchanged import of canonical catalogues, expect identical bytes. Investigate any unexpected difference before committing.

## Open the first pull request

Run `tolk check --ci`. For new or changed keys, run `tolk push -m "Introduce the coastal guide"` and inspect the accepted and refused IDs. Commit the code, configuration, workflows, extractor, project copy, drafts, language catalogues and `.gitattributes`. Open the PR. Require the **tolk/gate** commit status and up-to-date branches before merging so the verdict covers the current base. The introduction gate checks the keys have reached the engine at level `none`. E1 can merge new keys with draft fallback.

| Gate result | What to do on your branch |
|---|---|
| NOT PUSHED | Check the named ID’s description and draft, push the current key, and commit catalogue changes. |
| NOT PULLED | Run `tolk pull`, inspect the corrected lines and commit them. |
| BEHIND | Merge the current base into the branch. Resolve competing drafts, run `tolk check`, push, commit and rerun the gate. |

After merge, the main workflow runs `tolk refresh`. To deliver updates in E1, start a fresh branch from current main, run `tolk pull --latest`, inspect and commit the catalogue, cleanup and project-copy changes, then open an ordinary gated PR. If work remains after merge and refresh, repeat on a fresh branch. Branch deletion triggers scope close. Automated delivery PRs and generated translations belong to E2. The E1 Action commands are `gate`, `refresh` and `scope-close`.

See the [configuration, file formats and CLI role matrix](repository-reference.md).
