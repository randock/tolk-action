import { spawn } from 'node:child_process'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { install } from './install.mjs'
import { annotations, commentBody, gateOutputs, gateStatus, upsertComment } from './report.mjs'

// Treat extractor output, branch names and catalogue text as log data.
const log = value => console.log(String(value).split(/\r\n|\r|\n/).map(s => 'tolk | ' + s).join('\n'))

function cli(binary, args, env) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...env }
    for (const key of ['ACTION_GITHUB_TOKEN', 'TOLK_RELEASE_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) delete childEnv[key]
    const child = spawn(binary, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = [], err = []
    child.stdout.on('data', chunk => out.push(chunk))
    child.stderr.on('data', chunk => err.push(chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (err.length) log(Buffer.concat(err))
      if (signal) return reject(Error(`CLI terminated by ${signal}`))
      resolve({ code, stdout: Buffer.concat(out).toString() })
    })
  })
}

function github(env) {
  const root = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}`
  return async (path, method = 'GET', body) => {
    const response = await fetch(root + path, {
      method, headers: { Authorization: `Bearer ${env.ACTION_GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      redirect: 'error', body: JSON.stringify(body)
    })
    if (!response.ok) throw Error(`GitHub ${method} ${path} returned HTTP ${response.status}`)
    return response.status === 204 ? undefined : response.json()
  }
}

export async function run(env, event, { api = github(env), download = install, invoke = cli } = {}) {
  const cmd = env.ACTION_COMMAND
  const pr = event.pull_request
  if (cmd === 'gate') {
    if (env.GITHUB_EVENT_NAME !== 'pull_request' || !pr?.head?.sha || !pr.base) throw Error('gate requires a pull_request event')
    if (pr.head.repo?.id !== pr.base.repo.id) {
      log('Fork pull requests cannot publish tolk/gate. A maintainer can push the branch to this repository.')
      return 0
    }
    if (!['true','false'].includes(env.ACTION_COMMENT) || !['','fail','report'].includes(env.ACTION_ON_WAITING)) {
      throw Error('comment must be true or false and on-waiting must be empty, fail or report')
    }
  } else if (!['refresh','scope-close'].includes(cmd)) {
    throw Error(`Unsupported E1 command: ${cmd}`)
  }
  const dir = await mkdtemp(join(env.RUNNER_TEMP || tmpdir(), 'tolk-'))
  try {
    if (cmd !== 'gate') {
      let args = ['refresh']
      if (cmd === 'scope-close') {
        if (env.GITHUB_EVENT_NAME !== 'delete' || event.ref_type !== 'branch') throw Error('scope-close requires a branch delete event')
        let metadata
        try {
          metadata = await api(`/actions/runs/${env.GITHUB_RUN_ID}`)
        } catch (error) {
          throw Error(`Cannot read workflow run creation time (requires actions: read): ${error.message}`)
        }
        const deletedAt = metadata?.created_at
        if (typeof deletedAt !== 'string' || !Number.isFinite(Date.parse(deletedAt))) {
          throw Error('Missing or invalid workflow run creation time (requires actions: read)')
        }
        args = ['scope', 'close', '--deleted-at', deletedAt, '--', env.ACTION_SCOPE || event.ref]
      }
      const binary = await download(dir, env.ACTION_VERSION)
      const result = await invoke(binary, args, env)
      log(result.stdout)
      return result.code
    }

    let report, code
    try {
      const binary = await download(dir, env.ACTION_VERSION)
      const args = ['gate', '--wait', '--format', 'json', '--scope', pr.head.ref, '--commit', pr.head.sha,
        '--base', pr.base.ref, '--pull-request', String(event.number)]
      if (env.ACTION_LEVELS) args.push('--levels', env.ACTION_LEVELS)
      const result = await invoke(binary, args, env)
      code = result.code
      report = JSON.parse(result.stdout)
    } catch (error) {
      code = 3
      report = { errors: [error.message] }
    }
    const status = gateStatus(report, code, env.ACTION_ON_WAITING)
    for (const line of report.message || report.errors || []) log(line)
    if (report.verdict) {
      for (const annotation of annotations(report)) console.log(annotation)
      for (const [key, value] of Object.entries(gateOutputs(report))) {
        if (/[\r\n]/.test(value)) throw Error(`Invalid output: ${key}`)
        await appendFile(env.GITHUB_OUTPUT, `${key}=${value}\n`)
      }
    }
    const current = await api(`/pulls/${event.number}`)
    if (current.head.sha !== pr.head.sha || current.base.ref !== pr.base.ref) {
      log('The pull request head or base changed during the gate. Its newer run owns the result.')
      return 0
    }
    const posted = await api(`/statuses/${pr.head.sha}`, 'POST', { context: 'tolk/gate', ...status })
    if (env.ACTION_COMMENT === 'true') await upsertComment(api, event.number, posted.creator.login, commentBody(report, status))
    if (!report.verdict && code !== 4) return code || 1
    return report.verdict === 'failed' ? 1 : 0
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
    process.exitCode = await run(process.env, event)
  } catch (error) {
    log(error.message)
    process.exitCode = 1
  }
}
