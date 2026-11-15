// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A session's board on disk (R7): the Excalidraw file, the plain-text
// rendition the agent reads, the request file the agent writes, and the
// board's state (whether the person is editing, and whether they have asked
// for a review). The window edits the board; this module saves it atomically,
// keeps the rendition current, and passes on requests and outside changes.

import { mkdir, readFile, writeFile, rename, unlink, stat, access, cp } from 'node:fs/promises'
import { watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

const POLL_MS = 2000

// GARNET_SCOPING_BOARDS points the app at another folder, so that a test run
// never touches the person's boards.
export const BOARDS = process.env.GARNET_SCOPING_BOARDS || join(homedir(), '.garnet-scoping', 'boards')

export const boardPaths = (id, dir = BOARDS) => ({
  dir,
  board: join(dir, `${id}.excalidraw`),
  rendition: join(dir, `${id}.board.md`),
  request: join(dir, `${id}.request.json`),
  state: join(dir, `${id}.state.json`),
  // What became of the agent's last request (R12.1): written by the app.
  outcome: join(dir, `${id}.outcome.json`),
  files: join(dir, `${id}.files`),
})

// Images on the board (R7.8): kept in the board file, as the editor needs,
// and also written out one file each, so that the agent can open them.
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_')
export const imageFile = (filesDir, fileId, mimeType) => join(filesDir, `${safeId(fileId)}.${EXTENSIONS[mimeType] ?? 'bin'}`)

// Reads an image the agent names in a request, as a data URL.
export async function readImage(path) {
  const ext = String(path).split('.').pop().toLowerCase()
  const mimeType = IMAGE_TYPES[ext]
  if (!mimeType) throw new Error(`not an image this board takes (png, jpg, gif, webp or svg): ${path}`)
  const info = await stat(path)
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`image larger than 20 MB: ${path}`)
  const data = await readFile(path)
  return { mimeType, dataURL: `data:${mimeType};base64,${data.toString('base64')}` }
}

// The person's signals to the agent: editing and a review asked for (R7.6),
// the rows of the Desk they want to discuss (R2.7), and a hold (R2.8): the
// person asks the agent to stop after its current step ("requested"), the
// agent confirms it has stopped ("holding"), and the person releases it.
export const NO_STATE = { editing: false, review: false, reviewAt: null, discuss: [], hold: 'off', holdAt: null, questions: [], notes: [], asides: [], away: { on: false, until: null, at: null, backAt: null } }
const HOLDS = new Set(['off', 'requested', 'holding'])
const PANELS = new Set(['plan', 'now', 'trail', 'memory', 'foryou', 'subagents'])
const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : null)
function cleanMark(m) {
  if (!m || typeof m.id !== 'string' || !PANELS.has(m.panel) || typeof m.key !== 'string') return null
  // open: a request to discuss; off: turned off by the person, kept so it
  // can be turned on again; answered: the agent has answered it.
  const status = ['open', 'off', 'answered'].includes(m.status) ? m.status : 'open'
  const answered = status === 'answered' || (status === 'off' && typeof m.answer === 'string')
  return {
    id: m.id.slice(0, 40),
    panel: m.panel,
    key: m.key.slice(0, 400),
    text: str(m.text) ?? '',
    note: str(m.note),
    at: str(m.at, 40),
    status,
    answer: answered ? str(m.answer) : null,
    answeredAt: answered ? str(m.answeredAt, 40) : null,
  }
}
// A question the person asked on the board (R13): its text, the exchange it
// belongs to, what its arm points at, the picture of that area, and the
// agent's answer once given.
function cleanQuestion(q) {
  if (!q || typeof q.id !== 'string' || typeof q.exchange !== 'string') return null
  // draft: asked but not yet sent (the person sends with Review); open: sent;
  // answered: the agent has answered it.
  const status = ['draft', 'open', 'answered'].includes(q.status) ? q.status : 'open'
  return {
    id: q.id.slice(0, 40),
    exchange: q.exchange.slice(0, 40),
    text: str(q.text) ?? '',
    about: str(q.about, 400),
    picture: str(q.picture, 1000),
    follows: str(q.follows, 40),
    at: str(q.at, 40),
    status,
    answer: status === 'answered' ? str(q.answer) : null,
    answeredAt: status === 'answered' ? str(q.answeredAt, 40) : null,
  }
}
// A note the agent pinned to an item (R14): what it is pinned to, its one
// line, and the person's answer (confirmed, corrected with a line, or
// dismissed).
const NOTE_PANELS = new Set(['plan', 'foryou', 'board', 'lastword'])
function cleanNote(n) {
  if (!n || typeof n.id !== 'string' || !NOTE_PANELS.has(n.on?.panel)) return null
  const status = ['open', 'confirmed', 'corrected', 'dismissed'].includes(n.status) ? n.status : 'open'
  return {
    id: n.id.slice(0, 40),
    on: { panel: n.on.panel, key: str(n.on.key, 400) ?? '' },
    text: (str(n.text, 300) ?? '').replace(/\s+/g, ' '),
    at: str(n.at, 40),
    status,
    reply: status === 'corrected' ? str(n.reply, 300) : null,
    answeredAt: status === 'open' ? null : str(n.answeredAt, 40),
  }
}
// The agent's way of naming an item: "plan:<step>", "file:<path>",
// "shape:<id>" or "last-message".
export function noteTarget(on) {
  const s = String(on ?? '')
  if (s.startsWith('plan:')) return { panel: 'plan', key: s }
  if (s.startsWith('file:')) return { panel: 'foryou', key: s }
  if (s.startsWith('shape:')) return { panel: 'board', key: s.slice(6) }
  if (s === 'last-message') return { panel: 'lastword', key: 'lastword' }
  return null
}
// An aside (R16): a question about a row, answered by a copy of the session
// with no tools, so that the agent is not interrupted; kept with the marks.
function cleanAside(a) {
  if (!a || typeof a.id !== 'string' || !PANELS.has(a.panel) || typeof a.key !== 'string') return null
  return {
    id: a.id.slice(0, 40),
    panel: a.panel,
    key: a.key.slice(0, 400),
    text: str(a.text) ?? '',
    question: str(a.question) ?? '',
    at: str(a.at, 40),
    answer: str(a.answer, 4000),
    answeredAt: str(a.answeredAt, 40),
    error: str(a.error, 300),
  }
}
// Away (R17): whether the person is away, until when, and when they came back.
function cleanAway(a) {
  return { on: a?.on === true, until: str(a?.until, 40), at: str(a?.at, 40), backAt: str(a?.backAt, 40) }
}
export function cleanState(raw) {
  const review = raw?.review === true
  return {
    editing: raw?.editing === true,
    review,
    reviewAt: review && typeof raw.reviewAt === 'string' ? raw.reviewAt : null,
    discuss: (Array.isArray(raw?.discuss) ? raw.discuss : []).map(cleanMark).filter(Boolean).slice(-100),
    hold: HOLDS.has(raw?.hold) ? raw.hold : 'off',
    holdAt: HOLDS.has(raw?.hold) && raw.hold !== 'off' ? str(raw.holdAt, 40) : null,
    questions: (Array.isArray(raw?.questions) ? raw.questions : []).map(cleanQuestion).filter(Boolean).slice(-200),
    notes: (Array.isArray(raw?.notes) ? raw.notes : []).map(cleanNote).filter(Boolean).slice(-100),
    asides: (Array.isArray(raw?.asides) ? raw.asides : []).map(cleanAside).filter(Boolean).slice(-100),
    away: cleanAway(raw?.away),
  }
}
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond'])
const hash = (s) => createHash('sha1').update(s).digest('hex')

async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, text, typeof text === 'string' ? 'utf8' : undefined)
  await rename(tmp, path)
}

// The board as text (R7.3): each shape with its id, kind, text and position,
// each connection as "A → B", and free text, preceded by how to change it.
export function rendition(elements, { title = null, requestPath = '', statePath = '', state = NO_STATE, imagePath = null } = {}) {
  // The pieces of the questions' exchanges are listed under "## Questions".
  const all = elements.filter((e) => !e.isDeleted)
  const byId = new Map(all.map((e) => [e.id, e]))
  const live = all.filter((e) => !e.customData?.garnet)
  const textOf = (e) => {
    const bound = (e.boundElements ?? []).map((b) => byId.get(b.id)).find((x) => x && x.type === 'text')
    // The text as written, not as wrapped to fit the shape.
    return bound ? (bound.originalText ?? bound.text) : ''
  }
  const label = (id) => {
    const e = byId.get(id)
    if (!e) return id
    const t = textOf(e)
    return t ? `[${id}] "${t.replace(/\n/g, ' ')}"` : `[${id}]`
  }
  const pos = (e) => `(${Math.round(e.x)}, ${Math.round(e.y)}) ${Math.round(e.width)}×${Math.round(e.height)}`
  const lines = [`# Board${title ? `: ${title}` : ''}`, '']
  lines.push(
    `Editing: ${state.editing ? 'yes (the person is still changing the board)' : 'no'}`,
    `Review: ${state.review ? `requested${state.reviewAt ? ` at ${state.reviewAt}` : ''} (the person asks you to read the board now)` : 'not requested'}`,
    `Hold: ${
      state.hold === 'requested'
        ? `requested${state.holdAt ? ` at ${state.holdAt}` : ''} (finish the step you are in, start no other, send "holding": true, and wait until the person releases it)`
        : state.hold === 'holding'
          ? 'holding (you have stopped; wait until the person releases the hold)'
          : 'no'
    }`,
    `Discuss: ${(() => {
      const open = (state.discuss ?? []).filter((m) => m.status === 'open')
      return open.length ? `${open.length} open (rows of the Desk the person wants to talk about; listed under "discuss" in ${statePath || '<id>.state.json'})` : 'nothing open'
    })()}`,
    `Away: ${state.away?.on ? `yes, since ${state.away.at}${state.away.until ? `, back about ${state.away.until}` : ''} (keep your questions for the person's return; carry on with work that does not need them; assume nothing in their place)` : 'no'}`,
    `Notes you pinned: ${(() => {
      const ns = state.notes ?? []
      const answered = ns.filter((n) => n.status !== 'open').length
      return ns.length ? `${ns.length - answered} awaiting the person, ${answered} answered (listed under "## Notes" below)` : 'none'
    })()}`,
    `Questions: ${(() => {
      const open = (state.questions ?? []).filter((q) => q.status === 'open')
      return open.length ? `${open.length} open (asked on the board; listed under "## Questions" below)` : 'nothing open'
    })()}`,
    '',
    'This file is written by garnet-scoping whenever the board changes; do not edit it.',
    `To change the board, write a request to ${requestPath || '<id>.request.json'} as JSON:`,
    '{ "add": [ { "id": "a", "kind": "rectangle|ellipse|diamond|text", "text": "…", "x": 0, "y": 0 },',
    '           { "kind": "arrow|line", "from": "a", "to": "b", "text": "optional label" },',
    '           { "id": "i", "kind": "image", "path": "/absolute/path.png", "x": 0, "y": 0, "width": 400 } ],',
    '  "relabel": [ { "id": "a", "text": "…" } ], "remove": [ "id" ], "reviewed": true }',
    'Positions are optional; shapes without one are placed to the right of the board. The app applies the request and deletes the file.',
    'When a review is requested and you have read the board, include "reviewed": true (alone, or with changes): it turns the Review button off.',
    'For each open "discuss" item, answer the person in the conversation, then include "discussed": [ { "id": "…", "answer": "a line shown on the Desk" } ].',
    'When a hold is requested, finish the step you are in, start no other, include "holding": true, and wait until the Hold line reads "no".',
    'For each open question, answer on the board: "answers": [ { "id": "q…", "text": "a few lines" } ] (the app places your answer as a note joined to the question); for a longer answer, answer in the conversation and say so in the note.',
    'To pin a one-line note to an item instead of stopping to ask (an assumption you made, or something you want looked at), include "notes": [ { "on": "plan:<step text>" | "file:<path>" | "shape:<id>" | "last-message", "text": "Assumed: …" } ]; carry on without waiting for the answer.',
    'To remove an exchange the person and you have settled, include "removeExchange": [ "x…" ], and say in the conversation which one and why.',
    '',
    '## Shapes',
  )
  const shapes = live.filter((e) => SHAPES.has(e.type)).sort((a, b) => a.y - b.y || a.x - b.x)
  for (const e of shapes) lines.push(`- [${e.id}] ${e.type} "${textOf(e).replace(/\n/g, ' ')}" at ${pos(e)}`)
  if (!shapes.length) lines.push('- (none)')
  lines.push('', '## Connections')
  const links = live.filter((e) => e.type === 'arrow' || e.type === 'line')
  for (const e of links) {
    const from = e.startBinding?.elementId
    const to = e.endBinding?.elementId
    const t = textOf(e)
    const arrow = e.type === 'arrow' ? '→' : '—'
    lines.push(`- [${e.id}] ${from ? label(from) : '(unattached)'} ${arrow} ${to ? label(to) : '(unattached)'}${t ? ` labelled "${t.replace(/\n/g, ' ')}"` : ''}`)
  }
  if (!links.length) lines.push('- (none)')
  const free = live.filter((e) => e.type === 'text' && !e.containerId)
  if (free.length) {
    lines.push('', '## Free text')
    for (const e of free) lines.push(`- [${e.id}] "${(e.originalText ?? e.text).replace(/\n/g, ' ')}" at (${Math.round(e.x)}, ${Math.round(e.y)})`)
  }
  const images = live.filter((e) => e.type === 'image')
  if (images.length) {
    lines.push('', '## Images')
    for (const e of images) lines.push(`- [${e.id}] image at ${pos(e)}${imagePath && e.fileId ? `: ${imagePath(e.fileId)}` : ''}`)
  }
  const other = live.filter((e) => !SHAPES.has(e.type) && e.type !== 'text' && e.type !== 'arrow' && e.type !== 'line' && e.type !== 'image')
  if (other.length) lines.push('', `## Other`, `- ${other.length} element(s) of other kinds (${[...new Set(other.map((e) => e.type))].join(', ')}), not described here.`)
  // Questions not yet sent are the person's still.
  lines.push('', '## Asides (questions a copy of you answered, without interrupting you)')
  for (const a of state.asides ?? []) lines.push(`- [${a.id}] about "${a.text.replace(/\n/g, ' ').slice(0, 120)}": "${a.question}"${a.answer ? ` (answered: "${a.answer.replace(/\n/g, ' ').slice(0, 300)}")` : ''}`)
  if (!(state.asides ?? []).length) lines.push('- (none)')
  lines.push('', '## Notes')
  for (const n of state.notes ?? []) lines.push(`- [${n.id}] on ${n.on.panel} ${n.on.key}: "${n.text}" (${n.status}${n.reply ? `: "${n.reply}"` : ''})`)
  if (!(state.notes ?? []).length) lines.push('- (none)')
  const qs = (state.questions ?? []).filter((q) => q.status !== 'draft')
  lines.push('', '## Questions')
  for (const q of qs) {
    lines.push(`- [${q.id}] in exchange [${q.exchange}], ${q.status}${q.at ? ` (asked ${q.at})` : ''}: "${q.text.replace(/\n/g, ' ')}"`)
    if (q.about) lines.push(`  about: ${q.about}`)
    if (q.follows) lines.push(`  follows your answer to [${q.follows}]`)
    if (q.picture) lines.push(`  picture of that area: ${q.picture}`)
    if (q.answer) lines.push(`  your answer: "${q.answer.replace(/\n/g, ' ')}"`)
  }
  if (!qs.length) lines.push('- (none)')
  return lines.join('\n') + '\n'
}

// Merges elements from outside into the window's, element by element, the
// higher version winning (R7.5).
export function mergeElements(current, incoming) {
  const out = new Map(current.map((e) => [e.id, e]))
  for (const e of incoming) {
    const have = out.get(e.id)
    if (!have || (e.version ?? 0) > (have.version ?? 0)) out.set(e.id, e)
  }
  return [...out.values()]
}

// A session that continues an earlier one (resumed or forked under a new
// id) takes over that session's board once, by copy: its drawing and images,
// and the Discuss marks already settled (turned off or answered). Signals
// still open stay with the session they were given to. The first earlier
// session, most recent first, that has a drawing is the one used. Returns
// its id, or null when nothing was inherited (or it had been already).
export async function inheritBoard(id, ancestors, dir = BOARDS) {
  const p = boardPaths(id, dir)
  const readJson = async (f) => {
    try {
      return JSON.parse(await readFile(f, 'utf8'))
    } catch {
      return null
    }
  }
  const own = await readJson(p.board)
  if (own?.inheritedFrom !== undefined) return null
  const live = (els) => (Array.isArray(els) ? els.filter((e) => !e.isDeleted) : [])
  for (const anc of ancestors ?? []) {
    const ap = boardPaths(anc, dir)
    const theirs = await readJson(ap.board)
    if (!live(theirs?.elements).length) continue
    const elements = mergeElements(own?.elements ?? [], theirs.elements)
    const files = { ...(theirs.files ?? {}), ...(own?.files ?? {}) }
    const data = { ...(theirs ?? {}), ...(own ?? {}), elements, files, inheritedFrom: anc, source: 'garnet-scoping', style: 'plain' }
    await mkdir(dir, { recursive: true })
    await writeAtomic(p.board, JSON.stringify(data, null, 2))
    await cp(ap.files, p.files, { recursive: true, force: false, errorOnExist: false }).catch(() => {})
    const ownState = cleanState(await readJson(p.state))
    const settled = cleanState(await readJson(ap.state)).discuss.filter((m) => m.status !== 'open' && !ownState.discuss.some((o) => o.id === m.id))
    const state = { ...ownState, discuss: [...settled, ...ownState.discuss] }
    if (settled.length) await writeAtomic(p.state, JSON.stringify(state, null, 2))
    // The rendition at once, so that the agent can read the board it now has.
    const types = new Map(Object.values(files).map((f) => [f.id, f.mimeType]))
    const imagePath = (fid) => (types.has(fid) ? imageFile(p.files, fid, types.get(fid)) : null)
    await writeAtomic(p.rendition, rendition(elements, { requestPath: p.request, statePath: p.state, state, imagePath }))
    return anc
  }
  return null
}

// One session's board: load, save, and watch for requests and outside edits.
export function openBoard(id, { title = null, dir = BOARDS, onRequest, onExternal, onPending, onState, onDelivery }) {
  const p = boardPaths(id, dir)
  let lastWritten = null
  // The elements the rendition was last written from, and the board's state.
  let lastElements = null
  // The earlier session this board was continued from, kept across saves.
  let inheritedFrom = null
  let state = { ...NO_STATE }
  const stateLoaded = readFile(p.state, 'utf8').then(
    (t) => {
      try {
        state = cleanState(JSON.parse(t))
      } catch {}
    },
    () => {},
  )
  let closed = false
  // Requests wait on disk until the window's board is ready to apply them.
  let ready = false

  async function load() {
    await mkdir(dir, { recursive: true })
    try {
      const text = await readFile(p.board, 'utf8')
      lastWritten = hash(text)
      const data = JSON.parse(text)
      if (Array.isArray(data.elements)) lastElements = data.elements
      inheritedFrom = data.inheritedFrom ?? null
      fileTypes = new Map(Object.values(data.files ?? {}).map((f) => [f.id, f.mimeType]))
      return data
    } catch {
      return null
    }
  }

  // The files of the images on the board, by file id.
  let fileTypes = new Map()
  const imagePath = (fileId) => (fileTypes.has(fileId) ? imageFile(p.files, fileId, fileTypes.get(fileId)) : null)

  async function writeRendition() {
    if (!lastElements) await load()
    await writeAtomic(p.rendition, rendition(lastElements ?? [], { title, requestPath: p.request, statePath: p.state, state, imagePath }))
  }

  // The window reports the person's signals; the agent's "reviewed" clears
  // the review. Either way the state is kept on disk and in the rendition.
  async function setState(next) {
    await stateLoaded
    const before = state
    state = cleanState({ ...state, ...next, discuss: next.discuss ?? state.discuss })
    // Asking for a review means the person has finished editing.
    if (state.review && !before.review) {
      state.reviewAt = now()
      state.editing = false
    }
    if (state.hold !== before.hold) state.holdAt = state.hold === 'off' ? null : now()
    await mkdir(dir, { recursive: true })
    await writeAtomic(p.state, JSON.stringify(state, null, 2))
    await writeRendition()
    onState?.(state)
    return state
  }

  async function save(scene) {
    await mkdir(dir, { recursive: true })
    // Only the files of images still on the board are kept.
    const used = new Set(scene.elements.filter((e) => e.type === 'image' && !e.isDeleted && e.fileId).map((e) => e.fileId))
    const files = Object.fromEntries(Object.entries(scene.files ?? {}).filter(([fid, f]) => used.has(fid) && typeof f?.dataURL === 'string'))
    const text = JSON.stringify({ type: 'excalidraw', version: 2, source: 'garnet-scoping', style: 'plain', ...(inheritedFrom ? { inheritedFrom } : {}), elements: scene.elements, appState: { viewBackgroundColor: scene.background ?? '#0b1226' }, files }, null, 2)
    lastWritten = hash(text)
    lastElements = scene.elements
    await writeAtomic(p.board, text)
    fileTypes = new Map(Object.values(files).map((f) => [f.id, f.mimeType]))
    for (const f of Object.values(files)) {
      const out = imageFile(p.files, f.id, f.mimeType)
      const exists = await access(out).then(() => true, () => false)
      if (exists) continue
      const m = /^data:[^;]+;base64,(.*)$/s.exec(f.dataURL)
      if (!m) continue
      await mkdir(p.files, { recursive: true })
      await writeAtomic(out, Buffer.from(m[1], 'base64'))
    }
    await stateLoaded
    await writeAtomic(p.rendition, rendition(scene.elements, { title, requestPath: p.request, statePath: p.state, state, imagePath }))
  }

  // The person marks a row to discuss, withdraws a mark, or dismisses an
  // answered one; the agent answers marks through its request.
  async function discuss(op) {
    await stateLoaded
    if (op?.op === 'get') return state
    let list = [...state.discuss]
    if (op?.op === 'mark' && op.mark) {
      list = list.filter((m) => !(m.key === op.mark.key && m.status === 'open'))
      list.push({ ...op.mark, id: `d${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, at: now(), status: 'open' })
    } else if (op?.op === 'remove') {
      list = list.filter((m) => m.id !== op.id)
    } else if (op?.op === 'toggle') {
      // The flag: an open request is turned off; one turned off or answered
      // is requested again.
      list = list.map((m) => (m.id === op.id ? { ...m, status: m.status === 'open' ? 'off' : 'open', at: m.status === 'open' ? m.at : now() } : m))
    }
    return setState({ discuss: list })
  }

  function answered(items) {
    const byId = new Map()
    for (const it of items) {
      if (typeof it === 'string') byId.set(it, null)
      else if (it && typeof it.id === 'string') byId.set(it.id, typeof it.answer === 'string' ? it.answer : null)
    }
    return state.discuss.map((m) => (byId.has(m.id) && m.status === 'open' ? { ...m, status: 'answered', answer: byId.get(m.id), answeredAt: now() } : m))
  }

  let pendingReported
  async function readDelivery() {
    let watching = false
    try {
      const pid = Number((await readFile(join(dir, `${id}.watcher.pid`), 'utf8')).trim())
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
          watching = true
        } catch (e) {
          watching = e.code === 'EPERM'
        }
      }
    } catch {}
    const delivered = (await readFile(join(dir, `${id}.watched`), 'utf8').catch(() => '')).split('\n').filter(Boolean)
    return { watching, delivered }
  }
  let lastDelivery = ''
  async function checkDelivery() {
    const d = await readDelivery()
    const sig = JSON.stringify(d)
    if (sig !== lastDelivery) {
      lastDelivery = sig
      onDelivery?.(d)
    }
  }
  const writeOutcome = (o) => writeFile(p.outcome, JSON.stringify({ ...o, at: now() })).catch(() => {})

  // The agent's answers to the person's questions (R13.3).
  function answerQuestions(items) {
    const byId = new Map(items.filter((a) => a && typeof a.id === 'string').map((a) => [a.id, String(a.text ?? '').slice(0, 2000)]))
    return state.questions.map((q) => (byId.has(q.id) ? { ...q, status: 'answered', answer: byId.get(q.id), answeredAt: now() } : q))
  }

  // Answers to asides, written by the extension inside Claude Code (R16);
  // the app is the state file's only writer, so it folds them in.
  async function checkAsides() {
    let answers
    try {
      answers = JSON.parse(await readFile(join(dir, `${id}.asides.json`), 'utf8'))
    } catch {
      return
    }
    await stateLoaded
    let changed = false
    const asides = state.asides.map((a) => {
      const got = answers?.[a.id]
      if (!got || a.answeredAt) return a
      changed = true
      return { ...a, answer: typeof got.answer === 'string' ? got.answer : null, error: typeof got.error === 'string' ? got.error : null, answeredAt: now() }
    })
    if (changed) await setState({ asides })
  }

  async function checkRequest() {
    let text
    try {
      text = await readFile(p.request, 'utf8')
    } catch {
      return
    }
    let req
    try {
      req = JSON.parse(text)
    } catch (err) {
      // A request that is not JSON is reported and removed (R7.4).
      const error = `The request is not valid JSON: ${err.message}`
      await unlink(p.request).catch(() => {})
      await writeOutcome({ requestId: null, ok: false, error })
      if (ready) onRequest({ error })
      return
    }
    const changes = ['add', 'relabel', 'remove', 'removeExchange'].some((k) => Array.isArray(req?.[k]) && req[k].length)
    // A request with changes waits until the board is ready to apply them;
    // "reviewed" and "discussed" need no board and are applied at once.
    if (changes && !ready) {
      if (req.requestId !== pendingReported) {
        pendingReported = req.requestId
        await writeOutcome({ requestId: req.requestId ?? null, ok: true, queued: true, note: 'The board is not open in the window; the change waits and is applied when it opens.' })
      }
      return onPending?.()
    }
    await unlink(p.request).catch(() => {})
    // "holding" confirms a requested hold; it cannot start one.
    const holding = req?.holding === true && state.hold === 'requested'
    const answers = Array.isArray(req?.answers) ? req.answers : null
    const pinned = Array.isArray(req?.notes) ? req.notes.map((n) => ({ on: noteTarget(n?.on), text: n?.text })).filter((n) => n.on && typeof n.text === 'string' && n.text.trim()) : null
    if (req?.reviewed === true || Array.isArray(req?.discussed) || holding || answers || pinned) {
      await stateLoaded
      await setState({
        ...(req.reviewed === true ? { review: false } : {}),
        ...(Array.isArray(req.discussed) ? { discuss: answered(req.discussed) } : {}),
        ...(holding ? { hold: 'holding' } : {}),
        ...(answers ? { questions: answerQuestions(answers) } : {}),
        ...(pinned ? { notes: [...state.notes, ...pinned.map((n, i) => ({ id: `n${Date.now().toString(36)}${i}`, on: n.on, text: n.text, at: now(), status: 'open' }))] } : {}),
      })
    }
    if (!changes) await writeOutcome({ requestId: req?.requestId ?? null, ok: true, reviewed: req?.reviewed === true, discussed: Array.isArray(req?.discussed) ? req.discussed.length : 0, answered: answers ? answers.length : 0, pinned: pinned ? pinned.length : 0, notesRefused: Array.isArray(req?.notes) ? req.notes.length - (pinned?.length ?? 0) : 0, holding, holdIgnored: req?.holding === true && !holding })
    if (changes) {
      // An image the agent adds by path is read here and passed on as data.
      if (Array.isArray(req.add)) {
        for (const a of req.add) {
          if (a?.kind !== 'image') continue
          try {
            Object.assign(a, await readImage(String(a.path ?? '')))
          } catch (err) {
            a.error = err.message
          }
        }
      }
      onRequest({ request: req })
    }
  }

  async function checkBoard() {
    let text
    try {
      text = await readFile(p.board, 'utf8')
    } catch {
      return
    }
    if (hash(text) === lastWritten) return
    try {
      const data = JSON.parse(text)
      if (Array.isArray(data.elements)) onExternal(data.elements)
    } catch {}
  }

  let timer = null
  let watcher = null
  mkdir(dir, { recursive: true }).then(() => {
    if (closed) return
    try {
      watcher = watch(dir, (_event, name) => {
        if (!name || !name.startsWith(id)) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          checkDelivery()
          checkAsides()
          checkRequest()
          if (ready) checkBoard()
        }, 150)
      })
    } catch {}
    checkRequest()
  })
  // File events can be missed, so a waiting request is also looked for every
  // two seconds.
  const poll = setInterval(() => {
    checkRequest()
    checkDelivery()
    checkAsides()
  }, POLL_MS)

  return {
    paths: p,
    // The window reports what it did with a request's changes.
    outcome: (o) => writeOutcome({ ok: !(o?.problems?.length), ...o }),
    // Receipts (R15): whether a watcher is running for the session, and the
    // signals it has delivered, as the watcher itself records them.
    delivery: () => readDelivery(),
    // The picture of the area a question points at (R13.2), beside the board.
    async picture(qid, bytes) {
      if (typeof qid !== 'string' || !/^[\w-]{1,40}$/.test(qid) || !(bytes instanceof Uint8Array)) return null
      const file = join(dir, `${id}.q-${qid}.png`)
      await writeFile(file, bytes)
      return file
    },
    load,
    save,
    setState,
    discuss,
    state: async () => (await stateLoaded, state),
    // The window's board is mounted: apply any waiting request.
    ready() {
      ready = true
      checkRequest()
    },
    close() {
      closed = true
      clearInterval(poll)
      watcher?.close()
      clearTimeout(timer)
    },
  }
}
