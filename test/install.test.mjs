import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install } from '../src/install.mjs'
import { downloadVerifier } from '../src/signature.mjs'

const name = 'tolk-linux-amd64'
const bytes = Buffer.from('synthetic executable')
const digest = createHash('sha256').update(bytes).digest('hex')
const names = ['tolk-darwin-amd64', 'tolk-darwin-arm64', name, 'tolk-linux-arm64',
  'tolk-windows-amd64.exe', 'tolk-windows-arm64.exe']
const manifest = Buffer.from(names.map(n => digest + '  ' + n + '\n').join(''))

async function fixture(t, token = '') {
  const dir = await mkdtemp(join(tmpdir(), 'tolk-signature-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const assets = new Map([['SHA256SUMS', manifest], ['SHA256SUMS.sigstore.json', 'test bundle'], [name, bytes]])
  const fetched = []
  const metadata = { tag_name: 'cli-v0.1.0', assets: [...assets.keys()].map((name, id) => ({ name, id: id + 1 })) }
  const options = {
    platform: 'linux', arch: 'x64', token, readManifest: () => manifest, getVerifier: () => 'pinned verifier',
    verify: async (verifier, cwd, identity, issuer) => {
      assert.equal(verifier, 'pinned verifier')
      assert.equal(cwd, dir)
      assert.equal(identity, 'https://github.com/randock/tolk/.github/workflows/cli-release.yml@refs/tags/cli-v0.1.0')
      assert.equal(issuer, 'https://token.actions.githubusercontent.com')
      assert.deepEqual(await readFile(join(dir, 'SHA256SUMS')), manifest)
      assert.equal(await readFile(join(dir, 'SHA256SUMS.sigstore.json'), 'utf8'), 'test bundle')
      fetched.push('verified')
    },
    request: async (url, { headers }) => {
      assert.equal(headers.Authorization, token ? 'Bearer ' + token : undefined)
      const root = 'https://api.github.com/repos/randock/tolk-action/releases'
      if (url === root + '/tags/cli-v0.1.0') return Response.json(metadata)
      const entry = metadata.assets.find(a => url === root + '/assets/' + a.id)
      assert.ok(entry, 'unexpected release request')
      fetched.push(entry.name)
      return new Response(assets.get(entry.name))
    }
  }
  return { dir, assets, fetched, metadata, options }
}

for (const [route, token] of [['public', ''], ['private fixture', 'fixture-reader']]) {
  test(route + ' verifies all signed pins before fetching the selected binary', async t => {
    const f = await fixture(t, token)
    assert.deepEqual(await readFile(await install(f.dir, 'v0.1.0', f.options)), bytes)
    assert.deepEqual(f.fetched, ['SHA256SUMS', 'SHA256SUMS.sigstore.json', 'verified', name])
  })
}

for (const [problem, change, error] of [
  ['missing signature', f => f.metadata.assets.splice(1, 1), /Missing release asset/],
  ['other release', f => { f.metadata.tag_name = 'cli-v0.1.1' }, /Unexpected CLI release tag/],
  ['changed unselected platform', f => f.assets.set('SHA256SUMS', manifest.toString().replace(digest, '0'.repeat(64))), /differ from the pinned/],
  ['incomplete pins', f => { f.options.readManifest = () => Buffer.from(digest + '  ' + name) }, /six pinned platform/],
  ['untrusted signature', f => { f.options.verify = () => { throw Error('untrusted signature') } }, /untrusted signature/],
  ['changed binary', f => f.assets.set(name, 'tampered'), /Checksum mismatch/],
  ['no access', f => { f.options.request = () => new Response('', { status: 404 }) }, /HTTP 404/]
]) {
  test('installer rejects ' + problem, async t => {
    const f = await fixture(t)
    change(f)
    await assert.rejects(install(f.dir, 'v0.1.0', f.options), error)
    await assert.rejects(readFile(join(f.dir, name)), { code: 'ENOENT' })
    if (problem !== 'changed binary') assert.ok(!f.fetched.includes(name))
  })
}

test('a floating CLI version stops before any download', async () => {
  await assert.rejects(install('', 'latest', { request: () => assert.fail() }), /exact CLI version/)
})

test('a modified verifier fails its own pin without receiving release credentials', async t => {
  const f = await fixture(t, 'private-reader')
  await assert.rejects(downloadVerifier(f.dir, 'windows', 'arm64', async (...args) => {
    assert.deepEqual(args, ['https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-windows-amd64.exe'])
    return new Response('modified verifier')
  }), /Cosign checksum mismatch/)
})
