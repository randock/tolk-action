import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, open } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const release = 'https://github.com/sigstore/cosign/releases/download/v3.1.4'
// SHA-256 values from the immutable upstream v3.1.4 release.
const pins = {
  'cosign-darwin-amd64': '9d1e4abe2b6be279ed0d2ff706fde1ccd738747c834e3e6d44039c238867334f',
  'cosign-darwin-arm64': '9f9b8cd557cf2e5b3df3373a00baa005a86b02391e3e06dd0ce37b3a1533d3a4',
  'cosign-linux-amd64': '424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa',
  'cosign-linux-arm64': 'ade83b7aac62e131cacfe96d958948b2150cc9efec46a570a2649b8e27dedad2',
  'cosign-windows-amd64.exe': 'cbe953787074611f1334cbf37dc1cf953995bb8c45398eb4fc7bb781d29c1f2a'
}

export async function downloadVerifier(dir, os, cpu, request = fetch) {
  // Windows on Arm runs the upstream x64 verifier through x64 emulation.
  const name = os === 'windows' ? 'cosign-windows-amd64.exe' : `cosign-${os}-${cpu}`
  if (!pins[name]) throw Error('Unsupported Cosign platform')
  const response = await request(`${release}/${name}`)
  if (!response.ok) throw Error(`Cannot download Cosign (HTTP ${response.status})`)
  const path = join(dir, name)
  const file = await open(path, 'wx', 0o600)
  const hash = createHash('sha256')
  try {
    for await (const chunk of response.body) {
      hash.update(chunk)
      await file.writeFile(chunk)
    }
  } finally {
    await file.close()
  }
  if (hash.digest('hex') !== pins[name]) throw Error('Cosign checksum mismatch')
  await chmod(path, 0o700)
  return path
}

export async function verifyBlob(binary, dir, identity, issuer) {
  // Keep trust settings, working files and service credentials separate from the checkout.
  const env = { HOME: dir, USERPROFILE: dir, LOCALAPPDATA: dir, APPDATA: dir }
  for (const key of ['SystemRoot', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  await exec(binary, ['verify-blob', '--bundle', 'SHA256SUMS.sigstore.json',
    '--certificate-identity', identity, '--certificate-oidc-issuer', issuer, 'SHA256SUMS'],
  { cwd: dir, env, windowsHide: true })
}
