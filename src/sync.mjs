import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, lstat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { gateStatus } from './report.mjs'

const exec = promisify(execFile)
const git = async (...args) => (await exec('git', args, { maxBuffer: 32 * 1024 * 1024 })).stdout.trimEnd()
const headline = 'i18n: texts from tolk'

// Read the trusted default branch configuration using Psych, the standard YAML
// reader on GitHub's Ubuntu runners. Only these files can enter the signed commit.
async function filesFor(report) {
  const script = "require 'yaml';require 'json';puts JSON.generate(YAML.safe_load(File.read('tolk.yaml')).slice('catalogue','drafts','project_copy','engine'))"
  const cfg = JSON.parse((await exec('ruby', ['-e', script])).stdout)
  const counts = new Map()
  for (const { language } of [...report.texts, ...report.remove]) counts.set(language, (counts.get(language) || 0) + 1)
  const allowed = new Set([...counts.keys()].map(lang => cfg.catalogue.replace('{language}', lang)))
  if (report.drafts_remove.length) allowed.add(cfg.drafts || 'i18n/drafts.jsonl')
  allowed.add(cfg.project_copy || 'i18n/tolk.project.json')
  const additions = []
  for (const path of allowed) {
    const { stdout } = await exec('git', ['--literal-pathspecs','status','--porcelain=v1','--untracked-files=all','--',path])
    if (!stdout) continue
    if (!(await lstat(path)).isFile()) throw Error('Delivery must change ordinary files')
    additions.push({ path, contents: (await readFile(path)).toString('base64') })
  }
  const body = [...counts].sort().map(([lang, count]) => `- ${lang}: ${count}`).join('\n')
  return { additions, body: `[Tolk](${cfg.engine})\n\n${body}` + (report.complete ? '' : '\n\nMore texts will follow in the next delivery.') }
}

export async function sync(env, event, api, graphql, binary, invoke) {
  if (!['push','workflow_dispatch','schedule'].includes(env.GITHUB_EVENT_NAME)) throw Error('sync-pr requires a trusted repository workflow')
  const base = event.repository?.default_branch
  const branch = env.ACTION_BRANCH || 'chore/i18n-sync'
  if (!base || branch === base || branch.startsWith('-') || base.startsWith('-')) throw Error('Invalid delivery branch')
  for (const ref of [base,branch]) await git('check-ref-format', 'refs/heads/' + ref)
  if (await git('status','--porcelain')) throw Error('sync-pr needs a clean checkout')
  await git('fetch','--no-tags','origin',`+refs/heads/${base}:refs/remotes/origin/${base}`)
  const tip = await git('rev-parse', 'refs/remotes/origin/' + base)
  await git('switch','--detach',tip)
  const expected = (await git('ls-remote','--heads','origin','refs/heads/'+branch)).split('\t')[0]
  const pull = await invoke(binary,['pull','--latest','--format','json'],env)
  if (pull.code) throw Error(`tolk pull --latest failed (exit ${pull.code})`)
  const { additions, body } = await filesFor(JSON.parse(pull.stdout))
  const owner = env.GITHUB_REPOSITORY.split('/')[0]
  const [pr] = await api('/pulls?' + new URLSearchParams({ state:'open', base, head:owner+':'+branch }))
  if (!additions.length) {
    if (pr && pr.head.sha === expected) {
      // A concurrent delivery gets to keep the newer head.
      const current = await api('/pulls/'+pr.number)
      if (current.head.sha !== expected || (await git('ls-remote','--heads','origin','refs/heads/'+base)).split('\t')[0] !== tip) return 0
      await api('/issues/'+pr.number+'/comments','POST',{body:'Main has all current Tolk texts. Closing this sync pull request.'})
      await api('/pulls/'+pr.number,'PATCH',{state:'closed'})
    }
    return 0
  }

  // Build on a fresh temporary ref so resetting the sync branch to its base
  // cannot prematurely close an open PR. GitHub signs createCommitOnBranch.
  const temp = 'tolk-staging/'+randomUUID()
  await api('/git/refs','POST',{ref:'refs/heads/'+temp,sha:tip})
  let sha
  try {
    const query = 'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}'
    const data = await graphql(query,{ input:{branch:{repositoryNameWithOwner:env.GITHUB_REPOSITORY,branchName:temp},
      expectedHeadOid:tip,message:{headline},fileChanges:{additions}} })
    sha = data.createCommitOnBranch.commit.oid
    await git('fetch','--no-tags','origin','refs/heads/'+temp)
    if (await git('rev-parse','FETCH_HEAD') !== sha || await git('rev-parse',sha+'^') !== tip) throw Error('Signed commit does not match main')
    const remoteTip = (await git('ls-remote','--heads','origin','refs/heads/'+base)).split('\t')[0]
    if (remoteTip !== tip) throw Error('Main moved during delivery. Its refresh will rebuild the sync PR.')
    // Honour github-token for the push too, overriding checkout credentials.
    const header = 'Authorization: Basic '+Buffer.from('x-access-token:'+env.ACTION_GITHUB_TOKEN).toString('base64')
    const host = env.GITHUB_SERVER_URL || 'https://github.com'
    const key = 'http.'+host+'/.extraheader'
    await exec('git',['-c',key+'=','--config-env='+key+'=TOLK_PUSH_AUTH','push',
      `--force-with-lease=refs/heads/${branch}:${expected}`,'origin',sha+':refs/heads/'+branch],
      { env:{...process.env,TOLK_PUSH_AUTH:header} })
  } finally { await api('/git/refs/heads/'+temp,'DELETE') }
  const open = pr ? await api('/pulls/'+pr.number,'PATCH',{body}) :
    await api('/pulls','POST',{title:headline,head:branch,base,body})
  // Apply exactly the already uploaded paths, including newly created catalogues.
  await git('--literal-pathspecs','add','--',...additions.map(f=>f.path))
  await git('switch','--detach',sha)
  let report = {}, code = 3
  try {
    const judged = await invoke(binary,['gate','--wait','--format','json','--scope',branch,'--commit',sha,
      '--base',base,'--pull-request',String(open.number)],env)
    report = JSON.parse(judged.stdout)
    code = judged.code
  } finally {
    const current = await api('/pulls/'+open.number)
    if (current.head.sha === sha && current.base.ref === base) {
      await api('/statuses/'+sha,'POST',{context:'tolk/gate',...gateStatus(report,code,'')})
    }
  }
  return code
}
