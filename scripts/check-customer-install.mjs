// Exercise the customer entry point against public assets, keeping a copy of the
// first download to test subsequent failures with the same signed release.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../install.sh', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'tolk shell installer '))
const home = join(dir, 'test home')
const bin = join(home, '.local/bin')
const cache = join(dir, 'downloads')
const realCurl = execFileSync('sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).trim()
const env = { HOME: home, PATH: dir + ':' + process.env.PATH, CACHE: cache, CURL: realCurl }

try {
  await mkdir(home)
  await mkdir(cache)
  // Forward each first HTTPS request unchanged. Replay the downloaded bytes
  // during corruption checks so the verifier and binary are only fetched once.
  await writeFile(join(dir, 'curl'), `#!/bin/sh
set -eu
url=
output=
for arg do
    output=$url
    url=$arg
done
asset=$(basename "$url")
if [ -f "$CACHE/$asset" ]; then
    cp "$CACHE/$asset" "$output"
else
    "$CURL" "$@"
    cp "$output" "$CACHE/$asset"
fi
`, { mode: 0o700 })

  function run(...args) {
    return spawnSync('sh', [script, ...args], { env, encoding: 'utf8', timeout: 240_000 })
  }
  const installed = run()
  assert.equal(installed.status, 0, installed.stderr)
  assert.match(installed.stdout, /export PATH="\$HOME\/\.local\/bin:\$PATH"/)
  const path = join(bin, 'tolk')
  const help = execFileSync(path, ['--help'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  const assets = await readdir(cache)
  const binary = assets.find(name => name.startsWith('tolk-'))
  const verifier = assets.find(name => name.startsWith('cosign-'))
  assert.ok(binary && verifier, 'expected the native CLI and verifier')
  assert.deepEqual(await readFile(path), await readFile(join(cache, binary)))
  const previous = 'previous installation'
  await writeFile(path, previous)
  for (const [name, diagnostic] of [
    ['SHA256SUMS', /checksum mismatch for SHA256SUMS/],
    [verifier, /checksum mismatch for cosign/],
    ['SHA256SUMS.sigstore.json', /release signature verification failed/],
    [binary, /checksum mismatch for tolk-/]
  ]) {
    const asset = join(cache, name)
    const original = await readFile(asset)
    await writeFile(asset, 'corrupt fixture')
    const result = run()
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, diagnostic)
    assert.equal(await readFile(path, 'utf8'), previous)
    assert.deepEqual(await readdir(bin), ['tolk'])
    await writeFile(asset, original)
  }

  await unlink(path)
  await symlink(dir, path)
  assert.match(run().stderr, /expected a regular file/)
  assert.match(run('latest').stderr, /usage: sh install.sh/)
  console.log('Verified the public install, four integrity failures and destination handling.', help.trim())
} finally {
  await rm(dir, { recursive: true, force: true })
}
