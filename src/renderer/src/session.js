// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A session's window: the Desk (R2 to R4, R6) and, beside it, the board (R7).
// The Desk is redrawn whenever the main process says the session changed,
// keeping which turns are open and where each column is scrolled.

import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ago, clock, fileUrl, fromFile, since } from './util.js'
import { mountSessions, badge as stateBadge } from './sessions-panel.js'

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
const basename = (p) => String(p).split('/').pop()
// A path as short as it can be read: relative to the session's working
// folder when inside it, from ~ when inside the home folder.
const shortPath = (p) => {
  const cwd = view?.facts.cwd
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1)
  const home = /^(\/Users\/[^/]+|\/home\/[^/]+)/.exec(p)?.[1]
  return home ? '~' + p.slice(home.length) : p
}
// Markdown as HTML. For a file's own text, filePath makes its relative
// images load from the file's folder rather than from the app's.
const markdown = (text, filePath) => {
  const div = el('div', 'markdown')
  div.innerHTML = DOMPurify.sanitize(marked.parse(text ?? ''))
  if (filePath) for (const img of div.querySelectorAll('img[src]')) img.src = fromFile(img.getAttribute('src'), filePath)
  return div
}

const TRAIL_PAGE = 40
let trailShown = TRAIL_PAGE
const open = new Set() // turn indexes the person opened
const closed = new Set() // turn indexes the person closed
let view = null
let memory = null

// ---- the viewer: a note, or an action's command and output ----
function showViewer(title, body, { wide = false } = {}) {
  $('viewer').querySelector('.viewer-box').classList.toggle('wide', wide)
  $('viewer-title').textContent = title
  $('viewer-body').replaceChildren(body)
  $('viewer').hidden = false
}
$('viewer-close').addEventListener('click', () => ($('viewer').hidden = true))
$('viewer').addEventListener('mousedown', (e) => e.target === $('viewer') && ($('viewer').hidden = true))
window.addEventListener('keydown', (e) => e.key === 'Escape' && ($('viewer').hidden = true))

// ---- discussing a row (R2.7) ----
// Any row of Plan, Now, Trail or Memory can be marked for discussion: a
// double-click marks it (or withdraws an open mark), and the right-click
// menu marks it with or without a note. Marks live in the session's state
// file, where the agent's watcher sees them; the agent answers them there.
let marks = []
let notes = [] // the agent's notes (R14)
let asides = [] // the person's asides (R16)
let boardStateNow = null
let delivery = { watching: true, delivered: [] } // receipts (R15)
// The Discuss badge: lit while a request to discuss, outlined when turned
// off or answered; a click toggles it.
function badge(m, title) {
  const b = el('button', `discuss-badge ${m.status === 'open' ? 'on' : 'off'}`, 'Discuss')
  b.type = 'button'
  b.title = title
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleFlag(m.id)
  })
  b.addEventListener('dblclick', (e) => e.stopPropagation())
  return b
}
const openMark = (key) => marks.find((m) => m.key === key && m.status === 'open')
// A row's mark: its open one if any, else its latest (turned off or answered).
const markOf = (key) => openMark(key) ?? marks.findLast((m) => m.key === key)
const answeredMark = (key) => marks.findLast((m) => m.key === key && m.answer)
function toggleFlag(id) {
  return window.garnet.discuss({ op: 'toggle', id }).then(setMarks)
}

// ---- Hold (R2.8) ----
// The person asks the agent to stop after its current step; the agent
// confirms it has stopped; the person releases it with the same button.
let hold = 'off'
function showHold(state) {
  hold = state?.hold ?? 'off'
  const b = $('hold')
  b.className = `hold ${hold}`
  b.setAttribute('aria-pressed', String(hold !== 'off'))
  b.textContent = hold === 'requested' ? 'Hold requested' : hold === 'holding' ? 'Holding · Release' : 'Hold'
  b.title =
    hold === 'requested'
      ? 'Waiting for the agent to finish its current step; click to withdraw'
      : hold === 'holding'
        ? 'The agent has stopped and is waiting; click to release it'
        : 'Ask the agent to stop after its current step'
}
$('hold').addEventListener('click', () => {
  window.garnet.board.setState({ hold: hold === 'off' ? 'requested' : 'off' }).then(setMarks)
})

function setMarks(state) {
  showHold(state)
  marks = state?.discuss ?? []
  notes = state?.notes ?? []
  asides = state?.asides ?? []
  showAway(state)
  boardStateNow = state ?? boardStateNow
  renderDiscuss()
  if (view) {
    renderPresent()
    renderTrail()
    renderMemory()
    renderSubagents()
  }
}

function mark(row, note = null) {
  return window.garnet.discuss({ op: 'mark', mark: { panel: row.panel, key: row.key, text: row.text, note } }).then(setMarks)
}
function withdraw(id) {
  return window.garnet.discuss({ op: 'remove', id }).then(setMarks)
}
function toggleMark(row) {
  const m = openMark(row.key)
  return m ? withdraw(m.id) : mark(row)
}

function askNote(row) {
  const body = el('div', 'note-form')
  const area = el('textarea')
  area.rows = 3
  area.placeholder = 'What would you like to ask about it?'
  const go = el('button', 'primary', 'Discuss')
  go.type = 'button'
  const send = () => {
    $('viewer').hidden = true
    mark(row, area.value.trim() || null)
  }
  go.addEventListener('click', send)
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
  })
  body.append(el('div', 'muted', row.text), area, go)
  showViewer('Discuss, with a note', body)
  area.focus()
}

// ---- Away (R17) ----
function showAway(state) {
  const a = state?.away ?? { on: false }
  const btn = $('away')
  btn.classList.toggle('active', a.on)
  btn.setAttribute('aria-pressed', String(a.on))
  btn.textContent = a.on ? `Away${a.until ? ` until ${a.until}` : ''}` : 'Away'
  btn.title = a.on ? 'The agent knows you are away. Click when you are back: it will take you through what is pending, one item at a time.' : 'Tell the agent you are away: it keeps its questions for your return and carries on with what does not need you.'
  // What happened while the person was away (R17.3), until dismissed.
  const box = $('back-summary')
  let seen = null
  try {
    seen = localStorage.getItem('garnet.back-seen')
  } catch {}
  if (!a.on && a.at && a.backAt && seen !== a.backAt) {
    const within = (ts) => ts && ts >= a.at && ts <= a.backAt
    const n = (state.notes ?? []).filter((x) => within(x.at)).length
    const q = (state.questions ?? []).filter((x) => within(x.answeredAt)).length
    const s = (state.asides ?? []).filter((x) => within(x.answeredAt)).length
    box.replaceChildren(el('span', null, `While you were away (${clock(a.at)} to ${clock(a.backAt)}): ${n} note${n === 1 ? '' : 's'} from the agent, ${q} answer${q === 1 ? '' : 's'} on the board${s ? `, ${s} aside${s === 1 ? '' : 's'} answered` : ''}. The agent takes you through what is pending in the conversation.`))
    const ok = el('button', null, 'Dismiss')
    ok.type = 'button'
    ok.addEventListener('click', () => {
      try {
        localStorage.setItem('garnet.back-seen', a.backAt)
      } catch {}
      box.hidden = true
    })
    box.append(ok)
    box.hidden = false
  } else box.hidden = true
}
$('away').addEventListener('click', () => {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const a = boardStateNow?.away ?? { on: false }
  if (a.on) return window.garnet.board.setState({ away: { ...a, on: false, backAt: now } }).then(setMarks)
  const body = el('div', 'note-form')
  const until = el('input')
  until.type = 'time'
  const go = el('button', 'primary', 'I am away')
  go.type = 'button'
  go.addEventListener('click', () => {
    $('viewer').hidden = true
    window.garnet.board.setState({ away: { on: true, until: until.value || null, at: now, backAt: null } }).then(setMarks)
  })
  body.append(el('div', 'muted', 'Back about (optional):'), until, el('div', 'muted small', 'The agent keeps its questions for your return, carries on with work that does not need you, and assumes nothing in your place. When you click Away again, it takes you through what is pending, one item at a time.'), go)
  showViewer('Away', body)
})

// An aside (R16): a quick question about a row, answered at once by a copy
// of the session with no tools, while the agent works on undisturbed.
function askAside(row) {
  const body = el('div', 'note-form')
  const area = el('textarea')
  area.rows = 3
  area.value = `Why "${row.text.slice(0, 80)}"?`
  const go = el('button', 'primary', 'Ask aside')
  go.type = 'button'
  const send = () => {
    const question = area.value.trim()
    if (!question) return
    $('viewer').hidden = true
    const a = { id: `s${Date.now().toString(36)}`, panel: row.panel, key: row.key, text: row.text, question, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }
    window.garnet.board.setState({ asides: [...asides, a] }).then(setMarks)
  }
  go.addEventListener('click', send)
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), send())
  })
  body.append(el('div', 'muted', row.text), area, el('div', 'muted small', 'Answered at once by a copy of the session, which has no tools: it explains from what the session has done and can be wrong. It uses tokens. The agent is not interrupted.'), go)
  showViewer('Ask aside', body)
  area.focus()
  area.select()
}

const menu = $('ctx-menu')
function closeMenu() {
  menu.hidden = true
}
function showMenu(e, row, extra = []) {
  e.preventDefault()
  const items = [
    ['Discuss', () => mark(row)],
    ['Discuss, with a note…', () => askNote(row)],
    ['Ask aside…', () => askAside(row)],
  ]
  const m = openMark(row.key)
  if (m) items.push(['Withdraw the discussion', () => withdraw(m.id)])
  items.push(...extra)
  menu.replaceChildren(
    ...items.map(([label, act]) => {
      const b = el('button', null, label)
      b.type = 'button'
      b.addEventListener('click', () => {
        closeMenu()
        act()
      })
      return b
    }),
  )
  menu.hidden = false
  const { innerWidth: w, innerHeight: h } = window
  const r = menu.getBoundingClientRect()
  menu.style.left = `${Math.min(e.clientX, w - r.width - 4)}px`
  menu.style.top = `${Math.min(e.clientY, h - r.height - 4)}px`
}
window.addEventListener('mousedown', (e) => !menu.contains(e.target) && closeMenu())
window.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu())
window.addEventListener('blur', closeMenu)

// Makes a row markable. Its own click, if any, waits a moment so that a
// double-click does not also open it.
function markable(node, row, onClick = null, extra = []) {
  let timer = null
  if (onClick) {
    node.addEventListener('click', (e) => {
      if (e.detail > 1) return
      clearTimeout(timer)
      timer = setTimeout(onClick, 260)
    })
  }
  node.addEventListener('dblclick', (e) => {
    e.preventDefault()
    clearTimeout(timer)
    window.getSelection()?.removeAllRanges()
    toggleMark(row)
  })
  node.addEventListener('contextmenu', (e) => showMenu(e, row, extra))
  // A marked row carries the Discuss badge at its start; an unmarked row
  // keeps its full width.
  node.dataset.key = row.key
  const m = markOf(row.key)
  if (m) {
    const title =
      m.status === 'open'
        ? `A request to discuss${m.note ? `: ${m.note}` : ''}. Click to turn it off.`
        : `${m.status === 'answered' ? 'Answered' : 'Turned off'}${m.note ? ` (${m.note})` : ''}. Click to ask again.`
    // On a file, the badge sits on the tile's top-left corner; on a row, at
    // its right-hand end (before its time, where it has one), so that every
    // row still starts at the same place.
    const b = badge(m, title)
    if (node.classList.contains('delivery-file')) {
      node.classList.add('badged-file')
      node.prepend(b)
    } else {
      node.classList.add('badged')
      const end = node.querySelector(':scope > .when, :scope > .count')
      if (end) node.insertBefore(b, end)
      else {
        b.classList.add('end')
        ;(node.querySelector(':scope > .name') ?? node).prepend(b)
      }
    }
  }
  const done = answeredMark(row.key)
  if (done?.answer) node.append(el('div', 'discuss-answer', `Answered: ${done.answer}`))
  const aside = [...asides].reverse().find((a) => a.key === row.key)
  if (aside) {
    const box = el('div', 'aside-answer')
    box.append(el('div', 'aside-q', `Aside: ${aside.question}`))
    if (!aside.answeredAt) box.append(el('div', 'muted small', Date.now() - Date.parse(aside.at) > 30_000 ? 'No answer yet. Answers come from the garnet-board extension inside Claude Code: is it installed (Set-up Info)?' : 'Asking a copy of the session…'))
    else if (aside.answer) {
      box.append(el('div', null, aside.answer), el('div', 'muted small', 'Answered by a copy of the session, with no tools: it can explain, not check. The agent was not interrupted.'))
      const ask = el('button', 'aside-escalate', 'Ask the agent instead')
      ask.type = 'button'
      ask.addEventListener('click', (e) => (e.stopPropagation(), mark(row, aside.question)))
      box.append(ask)
    } else box.append(el('div', 'muted small', aside.error ?? 'No answer. Is the garnet-board extension installed (Set-up Info)?'))
    node.append(box)
  }
  return node
}


async function showDetail(action) {
  const d = await window.garnet.detail(action.id)
  const body = el('div')
  if (d?.command) {
    body.append(el('h2', null, 'Command'), Object.assign(el('pre'), { textContent: d.command }))
  }
  body.append(el('h2', null, d?.isError ? 'Output (an error)' : 'Output'), Object.assign(el('pre'), { textContent: d?.output ?? '(no output recorded)' }))
  showViewer(action.text, body)
}

// ---- pieces ----
function actionRow(a, { showAgo = false, panel = 'now' } = {}) {
  const li = el('li', `action${a.hasDetail ? ' detail' : ''}${a.isError ? ' error' : ''}${a.done ? '' : ' running'}`)
  li.append(el('span', 'text', a.text), el('span', 'when', showAgo ? ago(a.at) : clock(a.at)))
  if (a.target) li.title = a.target
  // An action that started a subagent leads to its row (R9.3).
  if (view?.subagents?.some((s) => s.id === a.id)) {
    const link = el('button', 'to-subagent', 'Subagent')
    link.type = 'button'
    link.title = 'Show this subagent in the Subagents panel'
    link.addEventListener('click', (e) => {
      e.stopPropagation()
      jumpTo({ panel: 'subagents', key: `subagent:${a.id}` })
    })
    li.append(link)
  }
  return markable(li, { panel, key: `action:${a.id}`, text: a.text }, a.hasDetail ? () => showDetail(a) : null)
}

// ---- the subagents (R9) ----
const openSubs = new Set()
const subDetail = new Map() // agent id -> detail, once read
const STATUS = { running: 'Running', finished: 'Finished', completed: 'Finished', stopped: 'Stopped without finishing', failed: 'Failed', killed: 'Stopped' }
const tokens = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const duration = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`)

function subagentRow(s, nested = false) {
  const box = el('div', `subagent${openSubs.has(s.id) ? ' open' : ''}${nested ? ' nested' : ''}`)
  const head = el('div', 'sub-head')
  head.append(el('span', 'name', s.task), el('span', `state-badge ${s.status === 'running' ? 'working' : s.status === 'finished' || s.status === 'completed' ? 'idle' : 'waiting'}`, STATUS[s.status] ?? s.status))
  const who = [s.type, [s.model, s.effort].filter(Boolean).join(', '), s.background ? 'background' : null].filter(Boolean).join(' · ')
  const figs = [s.durationMs != null ? duration(s.durationMs) : s.status === 'running' ? `started ${ago(s.startedAt)}` : null, s.tokens != null ? `${tokens(s.tokens)} tokens` : null, s.toolCalls != null ? `${s.toolCalls} tool calls` : null].filter(Boolean).join(' · ')
  head.append(el('span', 'meta', who), el('span', 'meta', figs))
  box.append(head)
  markable(head, { panel: 'subagents', key: `subagent:${s.id}`, text: `Subagent: ${s.task}` }, () => {
    if (openSubs.has(s.id)) openSubs.delete(s.id)
    else openSubs.add(s.id)
    renderSubagents()
  })
  if (!openSubs.has(s.id)) return box
  const body = el('div', 'sub-body')
  const d = s.agentId ? subDetail.get(s.agentId) : null
  if (s.agentId && !d) {
    body.append(el('p', 'muted', 'Reading its transcript…'))
    window.garnet.subagent(s.agentId).then((x) => {
      subDetail.set(s.agentId, x ?? { actions: [], subagents: [] })
      renderSubagents()
    })
  } else if (d) {
    const ul = el('ul', 'actions')
    for (const a of d.actions) ul.append(actionRow({ ...a, hasDetail: false }, { panel: 'subagents' }))
    if (d.actions.length) body.append(ul)
    else body.append(el('p', 'muted', 'No actions recorded.'))
    for (const n of d.subagents ?? []) body.append(subagentRow(n, true))
  }
  if (s.report) {
    const rep = el('div', 'sub-report')
    rep.append(el('h3', null, 'Final report'), Object.assign(markdown(s.report), { className: 'markdown' }))
    body.append(rep)
  } else body.append(el('p', 'muted', s.status === 'running' ? 'No report yet: still running.' : 'No report.'))
  if (!nested) {
    const back = el('button', 'to-trail', 'Show in Trail')
    back.type = 'button'
    back.addEventListener('click', () => jumpTo({ panel: 'trail', key: `action:${s.id}` }))
    body.append(back)
  }
  box.append(body)
  return box
}

function renderSubagents() {
  const list = view?.subagents ?? []
  $('subagents').replaceChildren(...(list.length ? list.map((s) => subagentRow(s)) : [el('p', 'muted', 'This session has started no subagents.')]))
}

function pathList(entries, kind) {
  const ul = el('ul', 'paths')
  for (const [path, how] of entries) {
    const li = el('li')
    li.append(el('span', 'how', how === 'write' ? 'wrote' : 'read'), document.createTextNode(kind === 'notes' ? basename(path).replace(/\.md$/, '') : shortPath(path)))
    li.title = path
    li.addEventListener('click', () => (kind === 'notes' ? openNote(path, basename(path)) : window.garnet.showInFinder(path)))
    ul.append(li)
  }
  return ul
}

// ---- the present state (R2) ----
function renderPresent() {
  const plan = $('plan')
  // A note the agent pinned to an item shows on the item (R14.2).
  const noteOn = (panel, key) => notes.find((n) => n.status === 'open' && n.on.panel === panel && n.on.key === key)
  const withNote = (node, panel, key) => {
    const n = noteOn(panel, key)
    if (n) node.append(el('div', 'note-badge', `From the agent: ${n.text}`))
    return node
  }
  plan.replaceChildren(...view.plan.items.map((it) => withNote(markable(el('li', it.status, it.content), { panel: 'plan', key: `plan:${it.content}`, text: it.content }), 'plan', `plan:${it.content}`)))
  if (!view.plan.items.length) plan.replaceChildren(el('li', 'muted', 'No plan in this session.'))

  $('now').replaceChildren(...(view.now.length ? view.now.map((a) => actionRow(a, { showAgo: true })) : [el('li', 'muted', 'No actions yet.')]))

  // Waiting (R10): background work from the transcript at once, and from
  // Claude Code's end-of-turn report, which also gives the scheduled jobs;
  // the session's own wake-ups from the transcript.
  const work = view.work
  const rows = []
  const seen = new Set()
  for (const w of view.waiting) {
    seen.add(w.id)
    const li = el('li', 'action running')
    li.append(el('span', 'text', w.text), el('span', 'when', since(w.startedAt)))
    rows.push(li)
  }
  for (const t of work?.tasks ?? []) {
    if (seen.has(t.id) || t.status !== 'running') continue
    const li = el('li', 'action running')
    li.append(el('span', 'text', t.text), el('span', 'when', 'running'))
    rows.push(li)
  }
  const fmtPrompt = (p) => (p.split('\n')[0] || '').slice(0, 160)
  const wakeRow = (when, recurring, prompt, full, key) => {
    const li = el('li', 'action wakeup')
    const text = el('span', 'text', `${recurring ? 'Recurs' : 'Wakes'} ${when}: ${fmtPrompt(prompt)}`)
    li.append(text)
    li.title = 'Click to show the whole prompt'
    let whole = false
    const toggle = () => {
      whole = !whole
      text.textContent = `${recurring ? 'Recurs' : 'Wakes'} ${when}: ${whole ? full : fmtPrompt(prompt)}`
    }
    return markable(li, { panel: 'now', key, text: `Wake-up ${when}` }, toggle)
  }
  for (const c of work?.crons ?? []) rows.push(wakeRow(c.next ? `at ${clock(c.next)}` : `on "${c.schedule}"`, c.recurring, c.prompt, c.prompt, `cron:${c.id}`))
  for (const w of view.wakeups ?? []) if (w.at > Date.now()) rows.push(wakeRow(`at ${clock(w.at)}`, false, w.reason || w.prompt, w.prompt || w.reason, `wake:${w.setAt}`))
  if (!rows.length) rows.push(el('li', 'muted', 'Nothing running in the background, and no wake-up set.'))
  rows.push(el('li', 'muted small', work ? `Claude Code's last report: ${ago(work.at)}.` : 'No end-of-turn report from Claude Code yet (the watcher hook writes it); shown from the transcript.'))
  $('waiting').replaceChildren(...rows)

  const lw = view.lastWord
  const box = $('last-word')
  box.replaceChildren()
  // The agent writes Markdown; it is shown rendered, whole, in a box that
  // scrolls when it is long.
  if (lw?.text) box.append(Object.assign(markdown(lw.text), { className: 'speech markdown' }))
  if (lw?.recap) box.append(el('div', 'recap', lw.recap))
  if (lw?.ask) box.append(el('div', 'awaiting', `Asked: ${lw.ask}`))
  const lwNote = notes.find((n) => n.status === 'open' && n.on.panel === 'lastword')
  if (lwNote) box.append(el('div', 'note-badge', `From the agent: ${lwNote.text}`))
  if (lw?.agentSpokeLast) box.append(el('div', 'awaiting', `The agent has spoken last${lw.at ? ` (${ago(lw.at)})` : ''}: your turn.`))
  else if (lw?.working) box.append(el('div', 'muted', 'The agent is at work.'))
  if (!box.childNodes.length) box.append(el('span', 'muted', 'Nothing yet.'))

  renderForYou()

  const t = $('touched')
  t.replaceChildren()
  if (view.touched.files.length) t.append(pathList(view.touched.files, 'files'))
  if (view.touched.notes.length) t.append(el('h2', null, 'Memory notes'), pathList(view.touched.notes, 'notes'))
  if (!t.childNodes.length) t.append(el('span', 'muted', 'No files or notes yet this turn.'))
}

// ---- For you (R2.9): the files the agent sent the person ----
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i
function renderForYou() {
  const box = $('for-you')
  const list = view.deliveries ?? []
  if (!list.length) return box.replaceChildren(el('span', 'muted', 'No files sent yet in this session.'))
  box.replaceChildren(
    ...list.slice(0, 6).map((d) => {
      const item = el('div', 'delivery')
      const head = el('div', 'delivery-head')
      head.append(el('span', 'caption', d.caption || (d.files.length === 1 ? basename(d.files[0].path) : `${d.files.length} files`)), el('span', 'when', ago(d.at)))
      item.append(head)
      const files = el('div', 'delivery-files')
      for (const f of d.files) {
        const tile = el('button', `delivery-file${f.exists ? '' : ' gone'}`)
        tile.type = 'button'
        tile.title = f.exists ? `${f.path}\nClick to preview; right-click for more.` : `${f.path}\nNo longer on disk.`
        if (f.exists && IMAGE.test(f.path)) {
          const img = el('img')
          img.src = fileUrl(f.path)
          img.alt = basename(f.path)
          tile.append(img)
        }
        tile.append(el('span', 'name', basename(f.path)))
        const row = { panel: 'foryou', key: `file:${f.path}`, text: `${basename(f.path)}${d.caption ? ` (${d.caption})` : ''}` }
        const extra = f.exists
          ? [
              ['Open in its default app', () => window.garnet.openFile(f.path)],
              [`Show in ${window.garnet.fileManager}`, () => window.garnet.showInFinder(f.path)],
            ]
          : []
        files.append(markable(tile, row, f.exists ? () => previewFile(f.path, row) : null, extra))
      }
      item.append(files)
      return item
    }),
  )
}

// The in-app preview of a delivered file, in the viewer overlay.
async function previewFile(path, row) {
  const name = basename(path)
  const body = el('div', 'preview')
  if (IMAGE.test(path)) {
    const img = el('img', 'preview-image')
    img.src = fileUrl(path)
    img.alt = name
    body.append(img)
  } else if (/\.pdf$/i.test(path)) {
    const frame = el('iframe', 'preview-pdf')
    frame.src = fileUrl(path)
    body.append(frame)
  } else {
    const r = await window.garnet.readFile(path)
    if (r?.kind === 'text') body.append(/\.(md|markdown)$/i.test(path) ? markdown(r.text, path) : Object.assign(el('pre', 'preview-text'), { textContent: r.text }))
    else if (r?.kind === 'gone') body.append(el('p', 'muted', 'This file is no longer on disk.'))
    else body.append(el('p', 'muted', `No preview for this kind of file${r?.size != null ? ` (${Math.ceil(r.size / 1024)} KB)` : ''}.`))
  }
  const bar = el('div', 'preview-bar')
  for (const [label, act] of [
    ['Open in its default app', () => window.garnet.openFile(path)],
    [`Show in ${window.garnet.fileManager}`, () => window.garnet.showInFinder(path)],
    ['Discuss…', () => askNote(row)],
  ]) {
    const b = el('button', null, label)
    b.type = 'button'
    b.addEventListener('click', act)
    bar.append(b)
  }
  showViewer(name, Object.assign(el('div'), { className: 'preview-wrap' }), { wide: true })
  $('viewer-body').firstChild.append(body, bar)
}

// ---- the trail (R3) ----
function turnEl(t, i, isLast) {
  const sec = el('article', 'turn')
  const head = el('header')
  const who = t.human ? t.human.text.split('\n')[0] || '(an image)' : 'Before the first message'
  const actions = t.items.filter((x) => x.type === 'action').length
  head.append(el('span', 'when', clock(t.at ?? t.items[0]?.at)), el('span', 'who', who), el('span', 'count', `${actions} action${actions === 1 ? '' : 's'}`))
  sec.append(head)
  const isOpen = open.has(i) || (isLast && !closed.has(i))
  markable(head, { panel: 'trail', key: `turn:${i}`, text: `Turn at ${clock(t.at ?? t.items[0]?.at)}: ${who}` }, () => {
    if (isOpen) {
      open.delete(i)
      closed.add(i)
    } else {
      open.add(i)
      closed.delete(i)
    }
    renderTrail()
  })
  if (!isOpen) return sec
  const body = el('div', 'body')
  if (t.human) {
    body.append(el('div', 'human', t.human.text))
    if (t.human.images) body.append(el('div', 'muted', `${t.human.images} image${t.human.images === 1 ? '' : 's'}`))
    if (t.human.inferred) body.append(el('div', 'inferred', 'Taken for the person’s message by elimination: this transcript predates the field that marks it.'))
  }
  const ul = el('ul', 'actions')
  const flush = () => {
    if (ul.childNodes.length) body.append(ul.cloneNode(false)), body.lastChild.replaceChildren(...ul.childNodes)
  }
  for (const [j, it] of t.items.entries()) {
    if (it.type === 'action') {
      ul.append(actionRow(it, { panel: 'trail' }))
      continue
    }
    flush()
    if (it.type === 'text') body.append(markable(Object.assign(markdown(it.text), { className: 'item text markdown' }), { panel: 'trail', key: `text:${i}:${j}`, text: it.text.replace(/\s+/g, ' ').slice(0, 300) }))
    else if (it.type === 'thinking') body.append(el('div', 'item thinking', it.text ? it.text : 'Reasoning: not kept in the transcript.'))
    else if (it.type === 'mid-turn') body.append(el('div', 'item mid-turn', `Sent mid-turn: ${it.text}`))
    else if (it.type === 'notification') body.append(el('div', 'item notification', `Finished in the background: ${it.text}`))
    else if (it.type === 'interrupt') body.append(el('div', 'item muted', 'Interrupted by the person.'))
    else if (it.type === 'compaction') body.append(compactionEl(it, i, j))
  }
  flush()
  if (t.recap) body.append(el('div', 'recap', t.recap))
  if (t.ask) body.append(el('div', 'awaiting', `Asked: ${t.ask}`))
  if (t.files.length) body.append(el('h2', null, 'Files'), pathList(t.files, 'files'))
  if (t.notes.length) body.append(el('h2', null, 'Memory notes'), pathList(t.notes, 'notes'))
  sec.append(body)
  return sec
}

// A compaction (R11): when, who started it, how much context it replaced; it
// opens to the summary the agent continues from, its first paragraph and
// then the whole.
const compactionOpen = new Map() // key -> 'first' | 'all'
function compactionEl(it, i, j) {
  const key = `compaction:${i}:${j}`
  const box = el('div', 'item compaction')
  const who = it.trigger === 'manual' ? 'by you (/compact)' : it.trigger === 'auto' ? 'by Claude Code (the context was full)' : ''
  const size = it.preTokens != null ? ` · ${tokens(it.preTokens)} tokens of context${it.postTokens != null ? ` replaced by a summary of ${tokens(it.postTokens)}` : ''}` : ''
  const line = el('div', 'compaction-line', `Context compacted at ${clock(it.at)} ${who}${size}`)
  box.append(line)
  markable(line, { panel: 'trail', key, text: `Compaction at ${clock(it.at)}` }, () => {
    compactionOpen.set(key, compactionOpen.has(key) ? undefined : 'first')
    if (!compactionOpen.get(key)) compactionOpen.delete(key)
    renderTrail()
  })
  const state = compactionOpen.get(key)
  if (state && it.summary) {
    const paras = it.summary.split(/\n\s*\n/)
    const shown = state === 'all' ? it.summary : paras[0]
    const sum = el('div', 'compaction-summary')
    sum.append(el('h3', null, 'The summary the agent continues from'), Object.assign(markdown(shown), { className: 'markdown' }))
    if (state !== 'all' && paras.length > 1) {
      const more = el('button', 'show-earlier', `Show all (${it.summary.split(/\s+/).length} words)`)
      more.type = 'button'
      more.addEventListener('click', () => {
        compactionOpen.set(key, 'all')
        renderTrail()
      })
      sum.append(more)
    }
    box.append(sum)
  } else if (state) box.append(el('p', 'muted', 'No summary was recorded.'))
  return box
}

function renderTrail() {
  const trail = $('trail')
  const col = trail.parentElement
  const atBottom = col.scrollHeight - col.scrollTop - col.clientHeight < 40
  const top = col.scrollTop
  const turns = view.turns
  const from = Math.max(0, turns.length - trailShown)
  const nodes = []
  if (from > 0) {
    const more = el('button', 'show-earlier', `Show ${Math.min(TRAIL_PAGE, from)} earlier turns (${from} hidden)`)
    more.type = 'button'
    more.addEventListener('click', () => {
      trailShown += TRAIL_PAGE
      renderTrail()
    })
    nodes.push(more)
  }
  for (let i = from; i < turns.length; i++) nodes.push(turnEl(turns[i], i, i === turns.length - 1))
  trail.replaceChildren(...nodes)
  col.scrollTop = atBottom ? col.scrollHeight : top
}

// ---- the facts and drift (R2.6, R6) ----
function renderFacts() {
  const f = view.facts
  document.title = f.title ?? view.id
  $('title').textContent = f.title ?? view.id
  const facts = $('facts')
  facts.replaceChildren()
  const parts = [f.model && `${f.model}${f.effort ? ` · ${f.effort}` : ''}`, f.branch && `branch ${f.branch}`, f.budgetLeft != null && `${f.budgetLeft.toLocaleString()} tokens left`, f.versions.length && `Claude Code ${f.versions[f.versions.length - 1]}`].filter(Boolean)
  if (f.cwd) {
    const a = el('a', null, f.cwd)
    a.href = '#'
    a.title = `Show in ${window.garnet.fileManager}`
    a.addEventListener('click', (e) => {
      e.preventDefault()
      window.garnet.showInFinder(f.cwd)
    })
    facts.append(a, document.createTextNode(' · '))
  }
  facts.append(document.createTextNode(parts.join(' · ')))
  for (const pr of f.prs.slice(-3)) facts.append(document.createTextNode(` · PR ${pr.number}`))

  const d = view.drift
  const notes = []
  if (d.unknown.length) notes.push(`Records of kinds this version does not know: ${d.unknown.map(([k, n]) => `${k} (${n})`).join(', ')}.`)
  if (d.bad) notes.push(`${d.bad} line${d.bad === 1 ? '' : 's'} could not be read.`)
  if (d.newerThanChecked) notes.push(`This session’s Claude Code (${f.versions[f.versions.length - 1]}) is newer than any this app was checked against (up to ${d.checked.highest}); some parts may be missing.`)
  $('drift').hidden = !notes.length
  $('drift').textContent = notes.join(' ')
}

// ---- the Memory pane (R4) ----
async function openNote(path, name) {
  const text = await window.garnet.readMemory(path)
  showViewer(name, text == null ? el('p', 'muted', 'This note could not be read.') : markdown(text.replace(/^---\n[\s\S]*?\n---\n/, '')))
}

function renderMemory() {
  const box = $('memory')
  box.replaceChildren()
  if (!memory || (!memory.notes.length && !memory.index)) {
    box.append(el('p', 'muted', 'This project has no memory notes.'))
    return
  }
  const used = new Set(view.turns.flatMap((t) => t.notes.map(([p]) => p)))
  if (memory.index) {
    const n = el('div', 'note')
    n.append(el('div', 'name', 'MEMORY (the index)'))
    box.append(markable(n, { panel: 'memory', key: `note:${memory.index.path}`, text: 'MEMORY (the index)' }, () => openNote(memory.index.path, 'MEMORY')))
  }
  let type = null
  for (const note of memory.notes) {
    if (note.type !== type) {
      type = note.type
      box.append(el('h2', 'memory-type', type))
    }
    const n = el('div', `note${used.has(note.path) ? ' used' : ''}`)
    n.title = used.has(note.path) ? 'Read or written in this session' : note.path
    n.append(el('div', 'name', note.name), el('div', 'desc', note.description))
    box.append(markable(n, { panel: 'memory', key: `note:${note.path}`, text: `Memory note ${note.name}` }, () => openNote(note.path, note.name)))
  }
}

// ---- the panels ----
// The panels the person turns on and off: Sessions, Desk, Trail, Memory, Discuss and Board.
// Which are on is remembered across windows; at least one stays on. The
// board takes half the window, on the side set in Settings, or all of it
// when it is the only panel on.
const PANELS = ['sessions', 'desk', 'trail', 'memory', 'discuss', 'subagents', 'board']
const PANELS_KEY = 'garnet.panels'
const DEFAULT_PANELS = { sessions: false, desk: true, trail: false, memory: false, discuss: false, subagents: false, board: true }
const SIDE = ['sessions', 'desk', 'trail', 'memory', 'discuss', 'subagents'] // the panels that share the Desk's half

function loadPanels() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY))
    const out = { ...DEFAULT_PANELS }
    for (const p of PANELS) if (typeof saved?.[p] === 'boolean') out[p] = saved[p]
    return PANELS.some((p) => out[p]) ? out : { ...DEFAULT_PANELS }
  } catch {
    return { ...DEFAULT_PANELS }
  }
}
let panels = loadPanels()
// The window the app opens at start shows the Sessions panel (R8.6).
if (new URLSearchParams(location.search).get('sessions') === '1') panels = { ...panels, sessions: true }
let boardSide = 'right'

// The board is loaded when it is first shown; Excalidraw finds its bundled
// fonts beside this page (no request leaves the app).
let boardMounted = false
let boardModule = null
async function mountBoardOnce() {
  if (boardMounted) return
  boardMounted = true
  $('tog-board').classList.remove('pending')
  window.EXCALIDRAW_ASSET_PATH = new URL('./', location.href).href
  boardModule = await import('./board.js')
  await boardModule.mountBoard($('board'))
}

function layout() {
  const others = SIDE.filter((p) => panels[p])
  for (const p of SIDE) $(`pane-${p}`).hidden = !panels[p]
  $('desk').hidden = !others.length
  $('board').hidden = !panels.board
  const stage = $('stage')
  stage.className = `stage board-${boardSide}${panels.board && others.length ? ' split' : ''}`
  for (const p of PANELS) {
    $(`tog-${p}`).classList.toggle('active', panels[p])
    $(`tog-${p}`).setAttribute('aria-pressed', String(panels[p]))
  }
  if (panels.board) mountBoardOnce()
  // The editor measures its container; it is told when that changes.
  requestAnimationFrame(() => boardModule?.refreshBoard())
}

function setPanels(next) {
  if (!PANELS.some((q) => next[q])) return
  panels = next
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(panels))
  } catch {}
  layout()
}
for (const p of PANELS) $(`tog-${p}`).addEventListener('click', () => setPanels({ ...panels, [p]: !panels[p] }))
window.garnet.onShowPanel((p) => PANELS.includes(p) && setPanels({ ...panels, [p]: true }))
const myId = new URLSearchParams(location.search).get('id')
mountSessions($('pane-sessions'), myId)
// This session's live state on the window's header (R8.1).
const showMyState = (l) => $('live-state').replaceChildren(...(l?.available === false ? [] : [stateBadge(l?.states?.[myId])]))
window.garnet.live.onChanged(showMyState)
window.garnet.live.get().then(showMyState)

// ---- the requests to discuss: a list, and the jump to each item ----
// The same list is shown in the Discuss panel and in the drop-down of the
// header's flag button. Choosing an entry shows its item in its own panel
// (turned on, a Trail turn opened, as needed), scrolled into view, with a
// highlight that fades over two seconds.
const WHERE = { plan: 'Plan', now: 'Now', trail: 'Trail', memory: 'Memory', foryou: 'For you', subagents: 'Subagents' }

function discussEntries() {
  const open = marks.filter((m) => m.status === 'open').reverse()
  const rest = marks.filter((m) => m.status !== 'open').reverse()
  return [...open, ...rest]
}

function discussItem(m, after) {
  const item = el('div', `discuss-item ${m.status}`)
  const flag = badge(m, m.status === 'open' ? 'Click to turn this request off' : 'Click to ask again')
  const body = el('div', 'discuss-body')
  body.append(el('div', 'discuss-what', m.text))
  const meta = [WHERE[m.panel] ?? m.panel, m.at ? ago(m.at) : null].filter(Boolean).join(' · ')
  body.append(el('div', 'discuss-meta', meta))
  if (m.note) body.append(el('div', 'discuss-note', `“${m.note}”`))
  if (m.answer) body.append(el('div', 'discuss-ans', `Answered: ${m.answer}`))
  if (m.status !== 'off') body.append(receipt(`discuss ${m.id} ${m.at}`, m.status === 'answered'))
  item.append(flag, body)
  item.title = 'Show it where it is'
  item.addEventListener('click', () => {
    after?.()
    jumpTo(m)
  })
  return item
}

// ---- the agent's notes (R14) ----
const NOTE_WHERE = { plan: 'Plan', foryou: 'For you', board: 'Board', lastword: 'Last word' }
function answerNote(n, status, reply = null) {
  const next = notes.map((x) => (x.id === n.id ? { ...x, status, reply, answeredAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') } : x))
  window.garnet.board.setState({ notes: next }).then(setMarks)
}
function noteItem(n) {
  const item = el('div', `discuss-item note ${n.status}`)
  const body = el('div', 'discuss-body')
  body.append(el('div', 'note-from', 'From the agent'), el('div', 'discuss-what', n.text))
  body.append(el('div', 'discuss-meta', [NOTE_WHERE[n.on.panel] ?? n.on.panel, n.on.panel === 'plan' ? n.on.key.slice(5) : n.on.panel === 'foryou' ? basename(n.on.key.slice(5)) : null, n.at ? ago(n.at) : null].filter(Boolean).join(' · ')))
  if (n.status === 'open') {
    const row = el('div', 'note-actions')
    const confirm = el('button', null, 'Confirm')
    const correct = el('button', null, 'Correct…')
    const dismiss = el('button', null, 'Dismiss')
    for (const b of [confirm, correct, dismiss]) b.type = 'button'
    confirm.addEventListener('click', (e) => (e.stopPropagation(), answerNote(n, 'confirmed')))
    dismiss.addEventListener('click', (e) => (e.stopPropagation(), answerNote(n, 'dismissed')))
    correct.addEventListener('click', (e) => {
      e.stopPropagation()
      const input = el('input', 'note-correction')
      input.placeholder = 'Your correction, then Enter'
      input.addEventListener('click', (ev) => ev.stopPropagation())
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && input.value.trim()) answerNote(n, 'corrected', input.value.trim())
        if (ev.key === 'Escape') input.replaceWith(row)
      })
      row.replaceWith(input)
      input.focus()
    })
    row.append(confirm, correct, dismiss)
    body.append(row)
  } else body.append(el('div', 'discuss-ans', n.status === 'corrected' ? `You corrected: ${n.reply}` : `You ${n.status} it.`))
  body.append(receipt(n.status === 'open' ? null : `note ${n.id} ${n.answeredAt}`, n.status !== 'open', n.status === 'open' ? 'pinned' : 'answer'))
  item.append(body)
  if (n.on.panel === 'plan' || n.on.panel === 'foryou') {
    item.title = 'Show it where it is'
    item.addEventListener('click', () => jumpTo({ panel: n.on.panel, key: n.on.key }))
  }
  return item
}

// ---- receipts (R15) ----
// Sent, then delivered (the watcher woke the session with it), then
// answered. Delivered means the session was woken, not that it was read.
function receipt(key, answered, kind = 'signal') {
  const sentLabel = kind === 'pinned' ? 'Pinned by the agent' : 'Sent'
  const delivered = answered || (key != null && delivery.delivered.includes(key))
  const box = el('div', 'receipt')
  const step = (text, on, bad = false) => el('span', `step${on ? ' on' : ''}${bad ? ' bad' : ''}`, text)
  if (kind === 'pinned') return box.append(step(sentLabel, true), step('Waiting for your answer', false)), box
  box.append(step('Sent', true), step(delivered ? 'Delivered' : delivery.watching ? 'Delivering…' : 'Not delivered', delivered, !delivered && !delivery.watching), step('Answered', answered))
  box.title = 'Delivered means the watcher woke the session with it, not that the agent has read it.'
  return box
}
function showDelivery(d) {
  if (d) delivery = d
  const warn = $('watch-warning')
  const waiting = marks.filter((m) => m.status === 'open').length + (boardStateNow?.review ? 1 : 0) + (boardStateNow?.hold === 'requested' ? 1 : 0)
  warn.hidden = delivery.watching
  const holdKey = boardStateNow?.hold === 'requested' ? `hold ${boardStateNow.holdAt}` : null
  if (holdKey) $('hold').title = delivery.delivered.includes(holdKey) ? 'Hold delivered: the agent was woken with it' : delivery.watching ? 'Hold sent; delivering…' : 'Hold sent, but no watcher is running, so it has not reached the agent'
  warn.textContent = `No watcher is running for this session, so your signals are not reaching it${waiting ? ` (${waiting} waiting)` : ''}. The watcher starts again at the end of the agent's next turn; if it never does, open Set-up Info from the app's menu.`
  renderDiscuss()
}
window.garnet.board.onDelivery(showDelivery)
window.garnet.board.delivery().then((d) => d && showDelivery(d))

function renderDiscuss() {
  const entries = discussEntries()
  const openCount = marks.filter((m) => m.status === 'open').length
  const btn = $('discuss-btn')
  btn.hidden = !marks.length
  btn.replaceChildren(el('span', 'discuss-badge on', 'Discuss'), el('span', 'count', String(openCount)))
  btn.classList.toggle('lit', openCount > 0)
  btn.title = openCount ? `${openCount} request${openCount === 1 ? '' : 's'} to discuss` : 'No open requests to discuss'
  const list = $('discuss-list')
  const openNotes = notes.filter((n) => n.status === 'open')
  const noteNodes = notes.length ? [el('h3', null, `Notes from the agent${openNotes.length ? ` (${openNotes.length} awaiting you)` : ''}`), ...[...openNotes, ...notes.filter((n) => n.status !== 'open')].reverse().map(noteItem), el('h3', null, 'Your requests to discuss')] : []
  list.replaceChildren(...noteNodes, ...(entries.length ? entries.map((m) => discussItem(m)) : [el('p', 'muted', 'Nothing marked to discuss in this session.')]))
  if (openNotes.length) {
    btn.hidden = false
    btn.append(el('span', 'note-count', `${openNotes.length} from the agent`))
    btn.classList.add('lit')
  }
  const drop = $('discuss-drop')
  if (!drop.hidden) fillDrop()
}

function fillDrop() {
  const drop = $('discuss-drop')
  drop.replaceChildren(...discussEntries().map((m) => discussItem(m, () => (drop.hidden = true))))
}
$('discuss-btn').addEventListener('click', (e) => {
  e.stopPropagation()
  const drop = $('discuss-drop')
  if (!drop.hidden) return (drop.hidden = true)
  fillDrop()
  const r = $('discuss-btn').getBoundingClientRect()
  drop.style.top = `${r.bottom + 6}px`
  drop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`
  drop.hidden = false
})
window.addEventListener('mousedown', (e) => {
  const drop = $('discuss-drop')
  if (!drop.hidden && !drop.contains(e.target) && e.target !== $('discuss-btn') && !$('discuss-btn').contains(e.target)) drop.hidden = true
})
window.addEventListener('keydown', (e) => e.key === 'Escape' && ($('discuss-drop').hidden = true))

// Shows a marked item where it is.
function jumpTo(m) {
  const key = m.key
  const want = { ...panels }
  let container = null
  if (m.panel === 'plan') {
    want.desk = true
    container = 'plan'
  } else if (m.panel === 'memory') {
    want.memory = true
    container = 'memory'
  } else if (m.panel === 'subagents') {
    want.subagents = true
    container = 'subagents'
    openSubs.add(key.slice(9))
    renderSubagents()
  } else if (m.panel === 'foryou') {
    want.desk = true
    container = 'for-you'
  } else if (m.panel === 'now' && document.querySelector('#now') && [...$('now').querySelectorAll('[data-key]')].some((n) => n.dataset.key === key)) {
    want.desk = true
    container = 'now'
  } else {
    // An action no longer in Now, or anything of the Trail: its place in the Trail.
    want.trail = true
    container = 'trail'
    const turnOf = () => {
      if (key.startsWith('turn:')) return Number(key.slice(5))
      if (key.startsWith('text:')) return Number(key.split(':')[1])
      if (key.startsWith('action:')) return view.turns.findIndex((t) => t.items.some((it) => it.type === 'action' && it.id === key.slice(7)))
      return -1
    }
    const i = turnOf()
    if (i >= 0) {
      open.add(i)
      closed.delete(i)
      trailShown = Math.max(trailShown, view.turns.length - i)
    }
  }
  if (SIDE.some((p) => want[p] !== panels[p])) setPanels(want)
  if (container === 'trail') renderTrail()
  requestAnimationFrame(() => {
    const node = [...$(container).querySelectorAll('[data-key]')].find((n) => n.dataset.key === key)
    if (!node) {
      if (m.panel === 'foryou') previewFile(key.slice(5), { panel: 'foryou', key, text: m.text })
      return
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    node.classList.remove('jumped')
    void node.offsetWidth
    node.classList.add('jumped')
  })
}
window.garnet.settings.get().then((s) => {
  boardSide = s.boardSide
  layout()
})
window.garnet.settings.onChanged((s) => {
  boardSide = s.boardSide
  layout()
})
layout()
// A request from the agent waits until the board is open: mark its toggle.
window.garnet.board.onPending(() => {
  if (!boardMounted) $('tog-board').classList.add('pending')
})

async function refresh() {
  const next = await window.garnet.view()
  if (!next) return
  view = next
  renderFacts()
  renderPresent()
  renderTrail()
  renderSubagents()
  memory = await window.garnet.listMemory()
  renderMemory()
}

window.garnet.onChanged(refresh)
// The marks to discuss: read once, then kept current by the main process.
window.garnet.discuss({ op: 'get' }).then(setMarks)
window.garnet.board.onState(setMarks)
setInterval(() => view && renderPresent(), 15_000) // keep the waiting times current
refresh()
