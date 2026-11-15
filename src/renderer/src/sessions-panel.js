// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Sessions panel (R8.6): every session with its live state (R8.1), why a
// waiting one waits (R8.4), in two views (R8.3): by project, or all sessions
// with those waiting first. A click opens the
// session's window or brings it forward. Within each project, sessions are
// ordered by last activity, most recent first.

import { ago, clock } from './util.js'

const byTime = (a, b) => b.modified - a.modified
const VIEW_KEY = 'garnet.sessions.view'
const LABEL = { working: 'Working', idle: 'Idle', waiting: 'Waiting for you', 'not-running': 'Not running', unknown: 'Unknown' }

const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

export function badge(st) {
  const s = st?.state ?? 'unknown'
  let text = LABEL[s]
  if (s === 'idle' && st.since) text = `Idle since ${clock(st.since)}`
  if (s === 'idle' && st.yourTurn) text += ' · your turn'
  return el('span', `state-badge ${s}`, text)
}

function why(st) {
  if (st?.state !== 'waiting' || !st.reason) return null
  const r = st.reason
  const since = r.at ?? st.since
  let text = r.text
  if (r.type === 'permission') text = `permission: ${r.text}`
  if (r.type === 'question') text = `question: "${r.text}"${r.options?.length ? ` (${r.options.join(' / ')})` : ''}`
  if (r.type === 'next-step') text = `asked: "${r.text}"`
  const parts = [since ? `since ${clock(since)}` : null, text, st.background ? 'background, attach to answer' : null].filter(Boolean)
  return el('div', 'why', `Waiting ${parts.join(' · ')}`)
}

export function mountSessions(root, currentId) {
  const viewBtns = root.querySelectorAll('[data-view]')
  const filterEl = root.querySelector('.sessions-filter')
  const listEl = root.querySelector('.sessions-list')
  const noteEl = root.querySelector('.sessions-note')
  let sessions = []
  let live = { available: true, states: {} }
  let view = 'project'
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    view = ['project', 'name', 'waiting'].includes(saved) ? saved : 'project'
  } catch {}

  const waitingFirst = (a, b) => (live.states[a.id]?.state === 'waiting' ? 0 : 1) - (live.states[b.id]?.state === 'waiting' ? 0 : 1)

  function row(s) {
    const st = live.states[s.id]
    const r = el('div', `sessions-row${s.id === currentId ? ' current' : ''}`)
    r.tabIndex = 0
    const head = el('div', 'head')
    head.append(el('span', 'name', s.title ?? s.firstMessage ?? s.id), badge(st))
    r.append(head, el('div', 'sub', [s.cwd ?? s.project, ago(s.modified)].filter(Boolean).join(' · ')))
    const w = why(st)
    if (w) r.append(w)
    const open = () => window.garnet.openSession({ id: s.id, file: s.file, project: s.project, title: s.title })
    r.addEventListener('click', open)
    r.addEventListener('keydown', (e) => e.key === 'Enter' && open())
    return r
  }

  function render() {
    for (const b of viewBtns) b.classList.toggle('active', b.dataset.view === view)
    noteEl.hidden = live.available
    const q = filterEl.value.trim().toLowerCase()
    const shown = sessions.filter((s) => !q || [s.title, s.cwd, s.firstMessage, s.project].some((v) => v && v.toLowerCase().includes(q)))
    if (!shown.length) return listEl.replaceChildren(el('p', 'muted', sessions.length ? 'No session matches.' : 'No Claude Code sessions found on this machine.'))
    if (view === 'waiting') return listEl.replaceChildren(...[...shown].sort(byTime).sort(waitingFirst).map(row))
    shown.sort(byTime)
    const groups = new Map()
    for (const s of shown) {
      const key = s.cwd ?? s.project
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(s)
    }
    const ordered = [...groups]
    // By project name: the groups in alphabetical order of the folder's name.
    const nameOf = (folder) => String(folder).split('/').filter(Boolean).at(-1)?.toLowerCase() ?? ''
    if (view === 'name') ordered.sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b)))
    listEl.replaceChildren(
      ...ordered.map(([folder, list]) => {
        const g = el('section', 'sessions-group')
        g.append(el('h3', null, folder), ...list.map(row))
        return g
      }),
    )
  }

  for (const b of viewBtns)
    b.addEventListener('click', () => {
      view = b.dataset.view
      try {
        localStorage.setItem(VIEW_KEY, view)
      } catch {}
      render()
    })
  filterEl.addEventListener('input', render)

  async function refresh() {
    sessions = await window.garnet.listSessions()
    render()
  }
  window.garnet.onSessionsChanged(refresh)
  window.garnet.live.onChanged((l) => {
    live = l
    render()
  })
  window.garnet.live.get().then((l) => {
    if (l) live = l
    render()
  })
  setInterval(render, 60_000) // keep "ago" current
  refresh()
}
