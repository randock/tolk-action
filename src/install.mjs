import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function install(dir, version, { platform = process.platform, arch = process.arch,
  token = process.env.TOLK_RELEASE_TOKEN, request = fetch, readManifest = readFile } = {}) {
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw Error('Use an exact CLI version such as v0.1.0')
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform]
  const cpu = { arm64: 'arm64', x64: 'amd64' }[arch]
  if (!os || !cpu) throw Error('Unsupported runner platform or architecture')
  const name = `tolk-${os}-${cpu}${os === 'windows' ? '.exe' : ''}`
  const manifest = await readManifest(new URL(`../checksums/${version}.txt`, import.meta.url), 'utf8')
  const digest = manifest.split('\n').map(line => line.split('  ')).find(([, file]) => file === name)?.[0]
  if (!/^[a-f0-9]{64}$/.test(digest || '')) throw Error(`No pinned checksum for ${name}`)

  const api = 'https://api.github.com/repos/randock/tolk-action/releases'
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const metadata = await request(`${api}/tags/cli-${version}`, { headers })
  if (!metadata.ok) throw Error(`Cannot read CLI release cli-${version} (HTTP ${metadata.status})`)
  const asset = (await metadata.json()).assets.find(a => a.name === name)
  if (!Number.isSafeInteger(asset?.id)) throw Error(`Missing release asset ${name}`)
  // Fetch strips Authorization on a cross-origin redirect to GitHub's asset storage.
  const response = await request(`${api}/assets/${asset.id}`, { headers: { ...headers, Accept: 'application/octet-stream' } })
  if (!response.ok) throw Error(`Cannot download ${name} (HTTP ${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw Error(`Checksum mismatch for ${name}`)
  const binary = join(dir, name)
  await writeFile(binary, bytes, { flag: 'wx', mode: 0o700 })
  return binary
}
