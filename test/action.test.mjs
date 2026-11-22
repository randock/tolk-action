import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install } from '../src/install.mjs'
import { run } from '../src/main.mjs'
import { annotations, commentBody, upsertComment } from '../src/report.mjs'

const pr = { head: { sha: 'a'.repeat(40), ref: 'feat/example', repo: { id: 9 } }, base: { ref: 'main', repo: { id: 9 } } }
const event = { number: 7, pull_request: pr }
const gateEnv = { ACTION_COMMAND: 'gate', GITHUB_EVENT_NAME: 'pull_request', ACTION_COMMENT: 'true', ACTION_ON_WAITING: '',
  ACTION_VERSION: 'v0.1.0', ACTION_LEVELS: 'en=none', GITHUB_SHA: 'merge-sha' }
const missing = { id: 'sample.title', file: 'src/sample.html', line: 13, detail: 'Push this draft' }
const base = { verdict: 'met', rule: 'default', levels: { en: 'none' }, groups: {}, message: ['tolk gate: summary'],
  url: 'https://engine.example/org/project/branches/feat%2Fexample',
  texts: [{ id: 'sample.title', draft: 'Sample draft', languages: { en: 'Sample text', nl: null } }] }

for (const [name, report, cliCode, override, state, job] of [
  ['met', base, 0, '', 'success', 0],
  ['failed', { ...base, verdict: 'failed', groups: { not_pushed: [missing] } }, 1, '', 'failure', 1],
  ['waiting by config', { ...base, verdict: 'waiting' }, 2, '', 'pending', 0],
  ['report by config', { ...base, verdict: 'waiting' }, 0, '', 'success', 0],
  ['report override', { ...base, verdict: 'waiting' }, 2, 'report', 'success', 0],
  ['fail override', { ...base, verdict: 'waiting' }, 0, 'fail', 'pending', 0],
  ['engine unavailable', { exit_code: 4, errors: ['Connection failed'] }, 4, '', 'error', 0],
  ['permission denied', { exit_code: 5, errors: ['Forbidden'] }, 5, '', 'error', 5],
]) {
  test(name, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'action-test-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const output = join(dir, 'outputs')
    const env = { ...gateEnv, ACTION_ON_WAITING: override, GITHUB_OUTPUT: output }
    const writes = []
    const api = async (path, method, body) => {
      if (path === '/pulls/7') return pr
      if (path.startsWith('/issues/7/comments?')) return []
      writes.push({ path, method, body })
      return { creator: { login: 'fixture-bot' } }
    }
    const rc = await run(env, event, { api, download: async () => '/verified/tolk', invoke: async (binary, args) => {
      assert.equal(binary, '/verified/tolk')
      assert.deepEqual(args, ['gate','--wait','--format','json','--scope','feat/example','--commit',pr.head.sha,
        '--base','main','--pull-request','7','--levels','en=none'])
      return { code: cliCode, stdout: JSON.stringify(report) }
    } })
    assert.equal(rc, job)
    const [status, comment] = writes
    assert.equal(status.path, '/statuses/' + pr.head.sha)
    assert.equal(status.body.context, 'tolk/gate')
    assert.equal(status.body.state, state)
    if (cliCode === 4) assert.equal(status.body.description, 'the engine could not be reached')
    if (state === 'success' && report.verdict === 'waiting') assert.equal(status.body.description, 'waiting, not blocking')
    assert.equal(comment.path, '/issues/7/comments')
    if (report.verdict) {
      assert.match(comment.body.body, /Sample draft/)
      assert.match(comment.body.body, /en: Sample text/)
      assert.match(comment.body.body, /nl: \(uses draft\)/)
      assert.equal(status.body.target_url, base.url)
      const fields = Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n').map(s => s.split('=')))
      assert.deepEqual(fields, { verdict: report.verdict, levels:'{"en":"none"}', rule:'default', waiting:'0',
        'not-pulled':'0','not-pushed':name === 'failed' ? '1':'0', behind:'0', blocked:'0','no-picture':'0' })
    }
  })
}

test('fork without secrets ends before install, checkout execution or API access', async () => {
  const unused = () => assert.fail('fork made a privileged call')
  const fork = { ...pr, head: { ...pr.head, repo: { id: 10 } } }
  assert.equal(await run(gateEnv, { ...event, pull_request: fork }, { api: unused, invoke: unused, download: unused }), 0)
})

test('report error on install failure; do not execute the CLI', async () => {
  const writes = []
  const rc = await run({ ...gateEnv, ACTION_COMMENT: 'false' }, event, {
    download: () => { throw Error('Checksum mismatch') }, invoke: () => assert.fail(),
    api: async (path, method, body) => { if (!method) return pr; writes.push(body); return {} }
  })
  assert.equal(rc, 3)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].state, 'error')
})

test('an old base run cannot overwrite the current gate on retarget', async () => {
  const rc = await run(gateEnv, event, {
    download: () => { throw Error('No release') }, api: async (path, method) => {
      assert.equal(method, undefined); return { ...pr, base: { ...pr.base, ref: 'release' } }
    }
  })
  assert.equal(rc, 0)
})

test('update only the posting identity’s marked comment, including later pages', async () => {
  const body = commentBody(base, {})
  const calls = []
  await upsertComment(async (path, method) => {
    calls.push(path)
    if (method === 'PATCH') return {}
    const other = { id: 1, user: { login: 'contributor' }, body }
    return path.endsWith('page=1') ? Array(100).fill(other) : [{ ...other, id: 42, user: { login: 'bot' } }]
  }, 7, 'bot', body)
  assert.equal(calls.at(-1), '/issues/comments/42')
})

test('escape workflow command properties and annotate the committed line', () => {
  const rows = annotations({ groups: { not_pushed: [{ ...missing, file: 'src/one,two.html', detail: 'bad\nline' }] } })
  assert.deepEqual(rows, ['::error file=src/one%2Ctwo.html,line=13::sample.title · not pushed · bad%0Aline'])
})

test('refresh and scope-close pass through CLI failure and use the original deletion time on retry', async () => {
  let args
  const deps = { download: () => 'tolk', invoke: (bin, argv) => { args = argv; return { code: 1, stdout: 'sample' } },
    api: path => { assert.equal(path, '/actions/runs/42'); return { created_at: '2026-11-20T10:00:00Z' } } }
  assert.equal(await run({ ACTION_COMMAND: 'refresh' }, {}, deps), 1)
  assert.deepEqual(args, ['refresh'])
  assert.equal(await run({ ACTION_COMMAND: 'scope-close', GITHUB_EVENT_NAME: 'delete', GITHUB_RUN_ID: '42' },
    { ref_type: 'branch', ref: 'feat/deleted' }, deps), 1)
  assert.deepEqual(args, ['scope','close','--deleted-at','2026-11-20T10:00:00Z','--','feat/deleted'])
})

test('installer verifies bytes against the manifest in the Action before writing an executable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'install-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bytes = Buffer.from('fixture executable bytes')
  const sha = createHash('sha256').update(bytes).digest('hex')
  const opts = { arch:'x64', platform:'linux', token:'read-only-demo', readManifest: () => sha + '  tolk-linux-amd64\n',
    request: async (url, { headers }) => {
      assert.equal(headers.Authorization, 'Bearer read-only-demo')
      if (url.endsWith('/tags/cli-v0.1.0')) return Response.json({assets:[{ id:4, name:'tolk-linux-amd64' }]})
      assert.equal(url, 'https://api.github.com/repos/randock/tolk-action/releases/assets/4')
      return new Response(bytes)
    } }
  await assert.rejects(install(dir,'latest',opts), /exact CLI version/)
  await assert.rejects(install(dir,'v0.1.0',{ ...opts, readManifest: () => '0'.repeat(64)+'  tolk-linux-amd64' }), /Checksum mismatch/)
  await assert.rejects(readFile(join(dir,'tolk-linux-amd64')), { code:'ENOENT' })
  await assert.rejects(install(dir,'v0.1.0',{ ...opts, token: '', request: async (_, {headers}) => {
    assert.equal(headers.Authorization, undefined); return new Response('', {status:404})
  } }), /HTTP 404/)
  assert.deepEqual(await readFile(await install(dir,'v0.1.0',opts)), bytes)
})

test('simultaneous first reports converge on a single gate comment', async () => {
  const comments = new Map()
  let id = 0
  const api = async (path, method, data) => {
    if (!method) return [...comments.values()]
    if (method === 'POST') {
      const row = { id: ++id, user: { login: 'bot' }, body: data.body }
      comments.set(row.id, row)
      return row
    }
    const number = Number(path.split('/').at(-1))
    if (method === 'DELETE') comments.delete(number)
    else comments.get(number).body = data.body
  }
  const body = commentBody(base, {})
  await Promise.all([upsertComment(api, 7, 'bot', body), upsertComment(api, 7, 'bot', body)])
  assert.equal(id, 2)
  assert.deepEqual([...comments.keys()], [1])
})
