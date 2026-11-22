const groups = ['not_pushed', 'behind', 'blocked', 'no_picture', 'not_pulled', 'waiting']
const marker = '<!-- randock/tolk-action gate -->'
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const data = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
const property = value => data(value).replaceAll(':', '%3A').replaceAll(',', '%2C')

export function gateStatus(report, code, onWaiting) {
  const verdict = report.verdict
  if (!['met', 'failed', 'waiting'].includes(verdict)) {
    return { state: 'error', description: code === 4 ? 'the engine could not be reached' : 'tolk gate could not complete' }
  }
  const blocking = onWaiting ? onWaiting === 'fail' : code === 2
  const state = { met: 'success', failed: 'failure', waiting: blocking ? 'pending' : 'success' }[verdict]
  const description = verdict === 'waiting' && !blocking ? 'waiting, not blocking' : report.message[0]
  const status = { state, description: [...description.split('\n')[0]].slice(0, 140).join('') }
  if (report.url && /^https?:\/\//.test(report.url)) status.target_url = new URL(report.url).href
  return status
}

export function gateOutputs(report) {
  const result = { verdict: report.verdict, levels: JSON.stringify(report.levels), rule: report.rule }
  for (const group of groups) result[group.replaceAll('_', '-')] = new Set((report.groups[group] || []).map(row => row.id)).size
  return result
}

export function annotations(report) {
  return groups.flatMap(group => (report.groups[group] || []).map(row => {
    const level = group === 'waiting' || group === 'not_pulled' ? 'warning' : 'error'
    const line = row.line > 0 ? `,line=${Number(row.line)}` : ''
    return `::${level} file=${property(row.file)}${line}::${data([row.id, group.replaceAll('_', ' '), row.language, row.detail].filter(Boolean).join(' · '))}`
  }))
}

export function commentBody(report, status) {
  const lines = [marker, '## Tolk gate', '']
  if (status.target_url) lines.push(`[View this branch in Tolk](<${status.target_url.replaceAll('>', '%3E')}>)`, '')
  // Bound each block at a line boundary to fit GitHub's issue comment limit.
  function block(title, text) {
    lines.push(title, '<pre>')
    for (const line of text) {
      if (line.length > remaining) { lines.push('… See the workflow log for details.'); break }
      lines.push(line)
      remaining -= line.length + 1
    }
    lines.push('</pre>')
  }
  let remaining = 40000
  block('', (report.message || report.errors || [status.description]).flatMap(s => s.split('\n')).map(escape))
  if (report.texts?.length) {
    remaining = 23000
    block('### Committed texts', report.texts.map(({ id, draft, languages }) => {
      const show = v => typeof v === 'string' ? v : JSON.stringify(v)
      return [id, `  draft: ${show(draft)}`, ...Object.entries(languages).map(([lang,v]) =>
        `  ${lang}: ${v === null ? '(uses draft)' : show(v)}`)].map(escape).join('\n')
    }))
  }
  return lines.join('\n')
}

async function firstGateComment(api, number, author) {
  for (let page = 1; ; page++) {
    const comments = await api(`/issues/${number}/comments?per_page=100&page=${page}`)
    const own = comments.find(c => c.user.login === author && c.body?.startsWith(marker))
    if (own) return own
    if (comments.length < 100) return null
  }
}

export async function upsertComment(api, number, author, body) {
  const existing = await firstGateComment(api, number, author)
  if (existing) return api(`/issues/comments/${existing.id}`, 'PATCH', { body })

  const created = await api(`/issues/${number}/comments`, 'POST', { body })
  // Two runs can both see an empty thread. GitHub lists comments oldest first.
  // A later creator retires only its own duplicate and updates the original.
  const first = await firstGateComment(api, number, author)
  if (first && first.id < created.id) {
    await api(`/issues/comments/${first.id}`, 'PATCH', { body })
    await api(`/issues/comments/${created.id}`, 'DELETE')
  }
}
