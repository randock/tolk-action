// Exercise the production verifier with an existing public upstream signature.
// The test creates no signing identity and makes no signing or log submissions.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadVerifier, verifyBlob } from '../src/signature.mjs'

const dir = await mkdtemp(join(tmpdir(), 'tolk-cosign-'))
try {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[process.platform]
  const cpu = { x64: 'amd64', arm64: 'arm64' }[process.arch]
  const verifier = await downloadVerifier(dir, os, cpu)
  const base = 'https://github.com/goreleaser/goreleaser/releases/download/v2.20.3'
  for (const suffix of ['', '.sigstore.json']) {
    const response = await fetch(`${base}/checksums.txt${suffix}`)
    assert.ok(response.ok, 'could not fetch signed upstream fixture')
    await writeFile(join(dir, 'SHA256SUMS' + suffix), Buffer.from(await response.arrayBuffer()))
  }
  const workflow = 'https://github.com/goreleaser/goreleaser/.github/workflows/release.yml'
  const identity = workflow + '@refs/tags/v2.20.3'
  const issuer = 'https://token.actions.githubusercontent.com'
  await verifyBlob(verifier, dir, identity, issuer)
  await assert.rejects(verifyBlob(verifier, dir, identity, 'https://accounts.google.com'))
  await assert.rejects(verifyBlob(verifier, dir, 'https://github.com/randock/tolk/.github/workflows/cli-release.yml@refs/tags/cli-v0.1.0', issuer))
  await assert.rejects(verifyBlob(verifier, dir, workflow + '@refs/tags/v2.20.4', issuer))
  await writeFile(join(dir, 'SHA256SUMS'), 'changed manifest')
  await assert.rejects(verifyBlob(verifier, dir, identity, issuer))
  console.log('Verified the upstream manifest and rejected the wrong issuer, wrong workflow, wrong tag and changed manifest.')
} finally {
  await rm(dir, { recursive: true, force: true })
}
