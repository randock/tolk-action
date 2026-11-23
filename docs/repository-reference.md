# E1 repository and CLI reference

This reference covers CLI **v0.1.0** and the public **v1** Action. For installation, token setup and the first import, follow [Connect your first repository](getting-started.md).

## Configuration

Commit one `tolk.yaml` at the repository root. The CLI searches the current directory and its parents, or takes an explicit `--config PATH`. Use clean, relative, slash-separated repository paths. The catalogue pattern must contain exactly one `{language}`. Each resolved catalogue, the drafts and the project copy need distinct paths.

```yaml
schema: 1
engine: https://api.example.com
project: field-guide
source: webapp
extractor: node scripts/manifest.mjs
sources: ["src/guide.json"]
catalogue: i18n/catalogue/{language}.jsonl
drafts: i18n/drafts.jsonl
project_copy: i18n/tolk.project.json
base: main
gate:
  levels: { "*": none }
```

Replace the example origin, slugs, extractor and paths with the values for your repository. Accepted keys are listed below. Unknown keys fail configuration parsing.

| Key | Meaning and default |
|---|---|
| `schema`, `engine`, `project`, `source` | Supply schema `1`, an HTTP(S) API origin and the slugs from source setup. `TOLK_ENGINE` overrides the configured origin. |
| `extractor`, `sources` | Required shell command and nonempty list of source globs. Include every input whose contents affect extraction. Git history must contain those files. Install the current checkout’s command and dependencies even when checking an older commit. |
| `catalogue`, `drafts`, `project_copy` | Supply the language pattern. Defaults for the other two are `i18n/drafts.jsonl` and `i18n/tolk.project.json`. |
| `base` | Target branch. Defaults to the branch identified by `origin/HEAD`. Fetch its tip and enough history to find a merge base. |
| `fingerprint.attributes` | Names of attributes whose values change the key. Defaults to an empty list. A change to the list can require pushing affected keys again. |
| `push.timeout` | Duration, default `15m`. E1 submits keys and pulls the available texts. Translation jobs start in E2. |
| `gate.levels` | Required map. Use `none` for E1 draft fallback. `machine` can leave a key waiting for text. An explicit language wins over `"*"`. Uncovered languages use `none`. Requiring `approved` is unsupported. |
| `gate.rules` | Optional ordered list, e.g. `[{branch: "release/*", levels: {en: machine}}]`. First matching rule replaces the whole default map. Patterns match the whole case-sensitive branch name. `*` includes slashes and `?` matches one character. |
| `gate.wait`, `gate.on_waiting` | The configured wait defaults to `10m`. CLI v0.1.0 accepts `--wait` and reports the current E1 verdict in one pass. Default waiting policy `fail` gives CLI exit 2 for a waiting verdict. `report` gives exit 0 for waiting. |
| `gate.pictures` | Accepts `off`, `report` (default) or `require`. Picture capture and delivery are later features. |

The gate examines the named head against its merge base and reads policy from the current base tip. A PR that introduces the config uses level `none` for all languages. On other PRs an explicit `--levels` map overrides the resolved rule.

## Extractor and manifest

The following example has one heading. The application identifies it in a one-line file, `src/guide.json`:

```json
{"id":"guide.title","description":"Page heading above the coastal walking routes"}
```

For **this single-file format**, save this extractor as `scripts/manifest.mjs`. It needs Node.js and uses its standard library. Adapt extraction to the calls and file types in your application.

```js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.TOLK_SOURCE_ROOT || process.cwd()
const file = 'src/guide.json'
const { id, description } = JSON.parse(readFileSync(join(root, file), 'utf8'))
console.log(JSON.stringify({
  schema: 1,
  source: 'webapp',
  draft_language: 'en',
  messages: [{ id, description, occurrences: [{ file, line: 1, kind: 'heading' }] }],
  problems: []
}))
```

Run `node scripts/manifest.mjs` at the root. A successful extractor exits zero and writes one UTF-8 JSON object to stdout. Send diagnostics to stderr. The CLI runs the working-copy command from the repository root. For historical extraction it sets `TOLK_SOURCE_ROOT` to a directory containing the matched files from that commit. Hard-coding the working directory would make an old revision look like the current one.

| Manifest field | Format |
|---|---|
| `schema`, `source`, `draft_language`, `messages` | Required. Use `1`, the configured source slug, the project’s draft language tag and a list with one entry per ID, sorted by ID. |
| `id`, `description`, `descriptions` | IDs match `^[a-z0-9_]+(\.[a-z0-9_]+)+$`, maximum 120 characters. Explain where and why the text is used. If call sites disagree, emit their distinct descriptions in `descriptions` so check can report the conflict. |
| `occurrences` | Required array per message. List each use with repository-relative `file`, 1-based `line` and its project `kind`, sorted by file and line. Optional context includes screen IDs, enclosing `box`, up to 12 `neighbours`, insertion target `into: {id, name}`, and limits `max_chars`, `max_hard`, `max_lines`. |
| `placeholders`, `forms` | Placeholders are sorted by name, e.g. `[{"name":"count","type":"number","example":3}]`. Supply a type or synthetic example. Types are `text`, `name`, `number`, `money`, `date`, `datetime`, `duration`, `code`, `url`, `email`, `boolean`. A plural axis, e.g. `{"plural":"count"}`, names its count placeholder. A variant axis, e.g. `{"variant":"audience"}`, names a project attribute marked as a variant. |
| `attributes`, `tags` | Per-message map of project attribute names to their allowed values, and sorted list of declared tag names. Define all attribute names, values and variant axes in the project before import. |
| `screens`, `problems` | Optional top-level lists. Screens have `id`, `title` and optional `route`, `about`. Report extraction problems as `{file, line, message}`. Resolve them before pushing. |

The CLI computes the fingerprint from the description, placeholder names/types, tags, forms and selected attribute values. The fingerprint and committed draft together identify the key for a message.

## Drafts, catalogues and the project copy

The drafts file has one entry per ID used by the application. Each language file, including the draft language, holds delivered texts. For the example heading, the draft line is:

```jsonl
{"k":"guide.title","v":"Coastal guide"}
```

Use UTF-8 without a BOM, LF line endings and a final LF on a nonempty file. Write one compact object per line with `k` first and `v` second, sorted by ID. An empty catalogue is a zero-byte file. Text is NFC-normalized and trimmed. Use `{name}` for a placeholder, `{{` and `}}` for literal braces. The same value shapes apply to drafts and language files:

| Message form | Synthetic example of `v` |
|---|---|
| Plain | `"Coastal guide"` |
| Plural | `{"one":"One route","other":"{count} routes"}` |
| Variant | `{"guide":"Lead a walk","walker":"Join a walk"}` |
| Both | `{"guide":{"one":"Lead one walk","other":"Lead {count} walks"},"walker":{"one":"Join one walk","other":"Join {count} walks"}}` |

Use the language’s plural categories and the variant attribute’s declared values. A runtime looks up the ID in the requested language, selects its variant and plural form, and falls back to the author’s draft when a translation is missing. Keep the `merge=union` entries written by init. Inspect competing draft lines after a merge and choose the intended value.

The committed project copy is the engine’s schema-1 JSON snapshot. `init` creates it if missing. `pull --latest` refreshes it. Offline checks read its language tags and plural categories, kind limits, attribute values, glossary and style patterns. For example, a project with a variant axis has this shape (the engine supplies the version):

```json
{
  "schema": 1, "version": "example",
  "languages": {"draft":"en","all":["en","nl"],"plural":{"en":["one","other"],"nl":["one","other"]}},
  "kinds": {"heading":{"group":"label","pictured":false}},
  "attributes": {"audience":{"values":["guide","walker"],"variant":true}},
  "glossary": {"names":[],"forbidden":{},"also_seen_as":{}},
  "style_patterns": {}
}
```

## Commands and roles

Run commands from your checkout. Global options include `--config PATH`, `--format text|json`, `--quiet`, `--help` and `--scope NAME` to supply the branch when needed. Roles below refer to a single source. **Author + Admin** can perform every operation listed for either role. CI is a separate grant. Use the web session for project Settings and token management.

| Command | Role | Effect |
|---|---|---|
| `tolk init` | Author, Admin or CI | Fetch the project copy and create missing repository files. To start without a config, supply `--engine URL --project SLUG --source SLUG`, then adapt the generated paths. |
| `tolk check [--ci]` | Offline | Check the working copy against its merge base. Missing translations can show the draft. CI also checks for unused catalogue IDs. |
| `tolk fmt [--last]` | Offline | Sort, normalize and deduplicate lines. With distinct values, use `--last` only after deciding to keep the last value for each ID. |
| `tolk prune` | Offline | Remove lines for unused IDs from drafts and language files. Review the diff. |
| `tolk find TEXT`, `tolk explain ID` | Offline | Search draft and catalogue text for matching IDs and locations, or show an ID’s extracted context and draft. |
| `tolk import --texts LANG=FILE[:LEVEL]` | Admin | Repeat `--texts` once per language. Use `supplied` (default) or `approved`. Submit inputs and wait for the worker report. Optional `--glossary FILE`, `--style FILE`, `--descriptions FILE`. |
| `tolk push [-m REASON] [--id ID] [--retry] [--no-wait]` | Author | Submit new or changed keys and update the working copy with available texts. Repeat `--id` to include specific keys, including a repair for an unpushed main key. The flags for retry and waiting apply to translation jobs from E2. |
| `tolk status` | Author or CI | Show acceptance and per-language state of the branch’s changed keys. |
| `tolk pull [--all] [--id ID]` | Author or CI | Apply texts and removals for the working copy. Unknown keys keep their lines. `--all` includes every key. Repeat `--id` to include named keys. |
| `tolk pull --latest` | Author or CI | Apply main’s pending delivery, including leftover removals and the current project copy. Run on a fresh delivery branch. This mode takes neither working-copy selector. |
| `tolk gate` | CI for engine calls | Judge the committed head. Options: `--commit REV`, `--base BRANCH`, `--pull-request NUMBER`, `--levels en=none,nl=machine`, `--wait` and `--report`. Ordinary exits: 0 met, 1 failed, 2 waiting under the default policy. Report mode always exits 0. Read its verdict or errors. |
| `tolk refresh [--force]` | CI | Report checked-out main and its history. Exit 1 identifies unpushed keys or competing drafts. Older ancestors are normally ignored. Use `--force` only for a deliberate override of commit ordering. |
| `tolk scope close BRANCH [--deleted-at TIME]` | CI | Report deletion with the original RFC 3339 timestamp. The Action retrieves the original run time on reruns. |
| `tolk delete ID [--yes]` | Admin | Confirm the unused ID to delete its message and history. `--yes` skips typing the ID. Main and open-branch use guards still apply. |

**Import files.** Use the committed JSON Lines format for texts. A separate import input may also give a line a `level` (`supplied` or `approved`) and `reason`. Keep these extra fields out of committed language files. Descriptions use JSON Lines such as `{"k":"guide.title","v":"Heading above the routes"}` for IDs missing a description. Glossary JSON contains a `concepts` array, for example `{"concepts":[{"name":"trail","description":"Walking path","type":"term","terms":{"nl":{"preferred":"pad"}}}]}`. Style JSON contains a `rules` array, for example `{"rules":[{"language":"nl","instruction":"Use everyday words.","severity":"warning"}]}`.

The CLI builds the import manifest from the extractor and drafts. `tolk import --format json` with your normal input flags returns the final report, including per-message outcomes, `would_refuse` push findings and `texts_refused`. A failed job or refused text exits 1, and a polling timeout exits 2. Review changed outcomes even on exit 0. Follow the [partial-import recovery steps](getting-started.md#import-existing-translations) before pulling.

**Delivery.** The v1 Action exposes `gate`, `refresh` and `scope-close`. E1 uses a manual delivery branch and `tolk pull --latest`. Automated delivery PRs are planned for E2. There is no E1 `sync-pr` command.
