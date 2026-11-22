import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadVerifier, verifyBlob } from './signature.mjs'

const targets = ['tolk-darwin-amd64', 'tolk-darwin-arm64', 'tolk-linux-amd64',
  'tolk-linux-arm64', 'tolk-windows-amd64.exe', 'tolk-windows-arm64.exe']
const api = 'https://api.github.com/repos/randock/tolk-action/releases'

export async function install(dir, version, { platform = process.platform, arch = process.arch,
  token = process.env.TOLK_RELEASE_TOKEN, request = fetch, readManifest = readFile,
  getVerifier = downloadVerifier, verify = verifyBlob } = {}) {
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw Error('Use an exact CLI version such as v0.1.0')
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform]
  const cpu = { arm64: 'arm64', x64: 'amd64' }[arch]
  if (!os || !cpu) throw Error('Unsupported runner platform or architecture')
  const name = `tolk-${os}-${cpu}${os === 'windows' ? '.exe' : ''}`
  const pinned = await readManifest(new URL(`../checksums/${version}.txt`, import.meta.url))
  const entries = pinned.toString('ascii').trimEnd().split('\n').map(line => line.split('  '))
  if (entries.length !== targets.length || entries.some(([digest, file, extra], i) =>
    file !== targets[i] || extra !== undefined || !/^[a-f0-9]{64}$/.test(digest))) {
    throw Error('Expected six pinned platform checksums')
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const metadata = await request(`${api}/tags/cli-${version}`, { headers })
  if (!metadata.ok) throw Error(`Cannot read CLI release cli-${version} (HTTP ${metadata.status})`)
  const release = await metadata.json()
  if (release.tag_name !== `cli-${version}`) throw Error('Unexpected CLI release tag')
  async function asset(name) {
    const entry = release.assets.find(a => a.name === name)
    if (!Number.isSafeInteger(entry?.id)) throw Error(`Missing release asset ${name}`)
    // Fetch strips Authorization on redirects to GitHub's asset storage.
    const response = await request(`${api}/assets/${entry.id}`, { headers: { ...headers, Accept: 'application/octet-stream' } })
    if (!response.ok) throw Error(`Cannot download ${name} (HTTP ${response.status})`)
    return Buffer.from(await response.arrayBuffer())
  }
  const sums = await asset('SHA256SUMS')
  if (!sums.equals(pinned)) throw Error('Release checksums differ from the pinned manifest')
  await writeFile(join(dir, 'SHA256SUMS'), sums, { flag: 'wx' })
  await writeFile(join(dir, 'SHA256SUMS.sigstore.json'), await asset('SHA256SUMS.sigstore.json'), { flag: 'wx' })
  const verifier = await getVerifier(dir, os, cpu)
  const identity = `https://github.com/randock/tolk/.github/workflows/cli-release.yml@refs/tags/cli-${version}`
  await verify(verifier, dir, identity, 'https://token.actions.githubusercontent.com')

  const bytes = await asset(name)
  if (createHash('sha256').update(bytes).digest('hex') !== entries[targets.indexOf(name)][0]) {
    throw Error(`Checksum mismatch for ${name}`)
  }
  const binary = join(dir, name)
  await writeFile(binary, bytes, { flag: 'wx', mode: 0o700 })
  return binary
}
