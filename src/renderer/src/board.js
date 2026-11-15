// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The board (R7): an Excalidraw editor over the session's board file. The
// person edits it here; the agent's requests (shapes to add, relabel or
// remove) and outside edits arrive from the main process and are merged in,
// element by element. Loaded only when the Board tab is first shown.

import React from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw, convertToExcalidrawElements, restoreElements, getSceneVersion, exportToBlob } from '@excalidraw/excalidraw'
import { armGeometry, asLine, tipOf } from './questions.js'
import '@excalidraw/excalidraw/index.css'

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond'])
const SIZE = { width: 180, height: 80 }
const DIAMOND = { width: 220, height: 130 }
const GRID = { columns: 3, dx: 300, dy: 200 }
const SAVE_MS = 400

// The board's look: text in Helvetica, the system's own face, and shapes and
// connections drawn with straight, sharp lines.
const NORMAL_FONT = 2 // Helvetica, in the file format's font numbering
// Midnight-blue ground and cream-yellow ink, which replaces the default black.
export const GROUND = '#0b1226'
const INK = '#f7f0d2'
// Black, and the earlier, deeper yellow, are replaced by the board's ink.
const DEFAULT_INKS = new Set(['#1e1e1e', '#000000', '#f2e2a0'])
const PLAIN = { roughness: 0, roundness: null }
const HAND_FONTS = new Set([1, 5, 6, 7, 8]) // the format's hand-drawn and display faces
const PLAIN_APP_STATE = { currentItemStrokeColor: INK, currentItemRoughness: 0, currentItemFontFamily: NORMAL_FONT, currentItemRoundness: 'sharp', currentItemArrowType: 'sharp' }

// Gives elements drawn in the hand-drawn style the plain one: a board saved
// before the plain style is converted once, when it is first opened.
export function toPlain(els) {
  return els.map((e) => {
    const changes = {}
    if (e.roughness) changes.roughness = 0
    if (e.roundness && e.type !== 'ellipse') changes.roundness = null
    if (e.type === 'text' && HAND_FONTS.has(e.fontFamily)) changes.fontFamily = NORMAL_FONT
    return Object.keys(changes).length ? bump(e, changes) : e
  })
}

// The board has one look: straight lines, Helvetica and yellow ink. A rough
// line, another face or black ink (from a board saved earlier, a paste, or an
// edit made outside) is brought to it.
const offStyle = (e) => e.roughness || DEFAULT_INKS.has(e.strokeColor) || (e.type === 'text' && e.fontFamily !== NORMAL_FONT)
const straighten = (els) =>
  els.map((e) => (offStyle(e) ? bump(e, { roughness: 0, ...(DEFAULT_INKS.has(e.strokeColor) ? { strokeColor: INK } : {}), ...(e.type === 'text' ? { fontFamily: NORMAL_FONT } : {}) }) : e))

let elements = []
// The images' data, by file id, as loaded; the editor keeps it from then on.
let initialFiles = {}
let api = null
let savedVersion = -1
let saveTimer = null
let statusEl = null

const live = () => elements.filter((e) => !e.isDeleted)
const bump = (e, changes) => ({ ...e, ...changes, version: (e.version ?? 1) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() })

function setStatus(text, isError = false) {
  if (!statusEl) return
  statusEl.textContent = text
  statusEl.classList.toggle('error', isError)
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const v = getSceneVersion(elements)
    if (v === savedVersion) return
    savedVersion = v
    window.garnet.board.save({ elements, files: api?.getFiles() ?? initialFiles }).catch((err) => {
      savedVersion = -1
      setStatus(`The board could not be saved: ${err.message}`, true)
    })
  }, SAVE_MS)
}

// The scene version the person has not changed: set after every change made
// by the app (an agent's request, an outside edit), so that onChange can tell
// the person's own edits from the app's.
let knownVersion = -1

function replaceScene(next) {
  elements = next
  knownVersion = getSceneVersion(elements)
  if (api) api.updateScene({ elements })
  scheduleSave()
}

// ---- the person's signals (R7.6) ----
let boardState = { editing: false, review: false }
let editingBox = null
let reviewButton = null

function showState(s) {
  boardState = s
  queueMicrotask(() => placeAnswers(s))
  if (editingBox) editingBox.checked = s.editing
  if (reviewButton) {
    reviewButton.classList.toggle('active', s.review)
    reviewButton.setAttribute('aria-pressed', String(s.review))
    reviewButton.title = s.review ? 'Waiting for the agent to read the board; click to withdraw the request' : 'Ask the agent to read the board now'
  }
}

function setState(next) {
  showState({ ...boardState, ...next })
  window.garnet.board.setState(next).then(showState, (err) => setStatus(`The board's state could not be saved: ${err.message}`, true))
}

// The point on a shape's box edge on the line from its centre towards `to`.
function edgePoint(e, to) {
  const cx = e.x + e.width / 2
  const cy = e.y + e.height / 2
  const dx = to.x - cx
  const dy = to.y - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const s = Math.min(Math.abs(e.width / 2 / (dx || 1e-9)), Math.abs(e.height / 2 / (dy || 1e-9)))
  return { x: cx + dx * s, y: cy + dy * s }
}
const centre = (e) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 })

// Applies one request from the agent (R7.4); returns what it did.
export function applyRequest(req, { fit = true } = {}) {
  const done = { added: 0, relabelled: 0, removed: 0, problems: [] }
  for (const x of Array.isArray(req.removeExchange) ? req.removeExchange : []) done.removed += removeExchange(String(x), { byAgent: true })
  let els = [...elements]
  const find = (id) => els.find((e) => e.id === id && !e.isDeleted)

  // Where shapes without a position go: a grid to the right of the board.
  const box = live().reduce((b, e) => ({ maxX: Math.max(b.maxX, e.x + e.width), minY: Math.min(b.minY, e.y) }), { maxX: 0, minY: Infinity })
  const originX = live().length ? box.maxX + 160 : 0
  const originY = Number.isFinite(box.minY) ? box.minY : 0
  let slot = 0
  const nextSlot = () => {
    const at = { x: originX + (slot % GRID.columns) * GRID.dx, y: originY + Math.floor(slot / GRID.columns) * GRID.dy }
    slot += 1
    return at
  }

  const adds = Array.isArray(req.add) ? req.add : []
  const shapes = adds.filter((a) => a && (SHAPES.has(a.kind) || a.kind === 'text' || a.kind === 'image'))
  const skeleton = []
  for (const a of shapes) {
    if (a.id && find(a.id)) {
      done.problems.push(`id "${a.id}" is already on the board`)
      continue
    }
    const placed = Number.isFinite(a.x) && Number.isFinite(a.y) ? { x: a.x, y: a.y } : nextSlot()
    const { x, y } = placed
    const size = a.kind === 'diamond' ? DIAMOND : SIZE
    if (a.kind === 'image') {
      if (a.error || !a.dataURL) {
        done.problems.push(`image ${a.id ?? a.path ?? ''}: ${a.error ?? 'no image data'}`)
        continue
      }
      const fileId = `img${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`
      api?.addFiles([{ id: fileId, dataURL: a.dataURL, mimeType: a.mimeType, created: Date.now() }])
      skeleton.push({ type: 'image', ...(a.id ? { id: String(a.id) } : {}), x, y, width: a.width, height: a.height, fileId })
    } else if (a.kind === 'text') skeleton.push({ type: 'text', ...(a.id ? { id: String(a.id) } : {}), x, y, text: String(a.text ?? ''), fontFamily: NORMAL_FONT })
    else skeleton.push({ type: a.kind, ...PLAIN, ...(a.id ? { id: String(a.id) } : {}), x, y, width: a.width ?? size.width, height: a.height ?? size.height, ...(a.text ? { label: { text: String(a.text), fontFamily: NORMAL_FONT } } : {}) })
  }
  if (skeleton.length) {
    const made = convertToExcalidrawElements(skeleton, { regenerateIds: false })
    els = els.concat(made)
    done.added += skeleton.length
  }

  // Connections, bound to the shapes they join.
  for (const a of adds.filter((x) => x && (x.kind === 'arrow' || x.kind === 'line'))) {
    const from = find(String(a.from))
    const to = find(String(a.to))
    if (!from || !to) {
      done.problems.push(`connection ${a.from} → ${a.to}: ${!from ? a.from : a.to} is not on the board`)
      continue
    }
    const p = edgePoint(from, centre(to))
    const q = edgePoint(to, centre(from))
    const [arrow, ...label] = convertToExcalidrawElements(
      [{ type: a.kind, ...PLAIN, x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y, points: [[0, 0], [q.x - p.x, q.y - p.y]], ...(a.text ? { label: { text: String(a.text), fontFamily: NORMAL_FONT } } : {}), ...(a.kind === 'arrow' ? { endArrowhead: 'arrow' } : {}) }],
      { regenerateIds: true },
    )
    const bound = { ...arrow, startBinding: { elementId: from.id, focus: 0, gap: 4 }, endBinding: { elementId: to.id, focus: 0, gap: 4 } }
    els = els.map((e) => (e.id === from.id || e.id === to.id ? bump(e, { boundElements: [...(e.boundElements ?? []), { id: arrow.id, type: 'arrow' }] }) : e))
    els.push(bound, ...label)
    done.added += 1
  }

  for (const r of Array.isArray(req.relabel) ? req.relabel : []) {
    const shape = find(String(r.id))
    const textId = shape?.boundElements?.find((b) => b.type === 'text')?.id
    if (!shape || !textId) {
      done.problems.push(`relabel ${r.id}: no labelled shape with that id`)
      continue
    }
    els = els.map((e) => (e.id === textId ? bump(e, { text: String(r.text ?? ''), originalText: String(r.text ?? '') }) : e))
    done.relabelled += 1
  }

  for (const id of Array.isArray(req.remove) ? req.remove.map(String) : []) {
    const target = find(id)
    if (!target) {
      done.problems.push(`remove ${id}: not on the board`)
      continue
    }
    // The element, its label, and any connection bound to it.
    const gone = new Set([id, ...(target.boundElements ?? []).map((b) => b.id)])
    for (const e of els) if (e.startBinding?.elementId === id || e.endBinding?.elementId === id) gone.add(e.id)
    for (const e of els) if (e.containerId && gone.has(e.containerId)) gone.add(e.id)
    els = els.map((e) => (gone.has(e.id) && !e.isDeleted ? bump(e, { isDeleted: true }) : e))
    done.removed += 1
  }

  replaceScene(restoreElements(straighten(els), null, { refreshDimensions: true }))
  if (api && done.added && fit) api.scrollToContent(undefined, { fitToContent: true, animate: true })
  return done
}

// Outside edits to the board file: merged by element, the higher version winning (R7.5).
function mergeExternal(incoming) {
  const out = new Map(elements.map((e) => [e.id, e]))
  for (const e of incoming) {
    const have = out.get(e.id)
    if (!have || (e.version ?? 0) > (have.version ?? 0)) out.set(e.id, e)
  }
  replaceScene(restoreElements(straighten([...out.values()]), null))
}

// Tells the editor its container has changed size or place.
export function refreshBoard() {
  api?.refresh()
}

// Gives each image in a request its size: the one asked for, or its own,
// scaled down to at most IMAGE_MAX on its longer side.
const IMAGE_MAX = 480
async function sizeImages(req) {
  for (const a of Array.isArray(req?.add) ? req.add : []) {
    if (a?.kind !== 'image' || !a.dataURL) continue
    try {
      const img = new Image()
      img.src = a.dataURL
      await img.decode()
      const w = img.naturalWidth || IMAGE_MAX
      const h = img.naturalHeight || IMAGE_MAX
      const scale = Number.isFinite(a.width) ? a.width / w : Math.min(1, IMAGE_MAX / Math.max(w, h))
      a.width = Math.round(w * scale)
      a.height = Math.round(h * scale)
    } catch {
      a.error = 'the image could not be read'
    }
  }
}

// ---- questions on the board (R13) ----
const QC = { fill: '#e1f5ee', ink: '#085041', line: '#1d9e75' } // the person's
const AC = { fill: '#faeeda', ink: '#633806', line: '#ba7517' } // the agent's
const tag = (e) => e?.customData?.garnet ?? null
const uid = (p) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
let holderEl = null
let overlayEl = null // the board's panel, which holds the menu and the typing balloon above the editor
let menuEl = null

// Restyles elements by id, as the app's own change.
function patch(ids, fn) {
  replaceScene(elements.map((e) => (ids.has(e.id) ? bump(e, fn(e)) : e)))
}

function toScene(cx, cy) {
  const s = api.getAppState()
  const r = holderEl.getBoundingClientRect()
  return { x: (cx - r.left) / s.zoom.value - s.scrollX, y: (cy - r.top) / s.zoom.value - s.scrollY }
}
function toClient(p) {
  const s = api.getAppState()
  const r = holderEl.getBoundingClientRect()
  return { x: (p.x + s.scrollX) * s.zoom.value + r.left, y: (p.y + s.scrollY) * s.zoom.value + r.top }
}

// The smallest shape under a point, not counting arms.
function hit(p) {
  let best = null
  for (const e of live()) {
    if (tag(e)?.role === 'arm' || tag(e)?.role === 'tip' || e.containerId) continue
    if (p.x >= e.x && p.x <= e.x + e.width && p.y >= e.y && p.y <= e.y + e.height && (!best || e.width * e.height < best.width * best.height)) best = e
  }
  return best
}

// Keeps every balloon's arm on what it points at (R13.4).
let armsQueued = false
function queueArms() {
  if (armsQueued) return
  armsQueued = true
  requestAnimationFrame(() => {
    armsQueued = false
    updateArms()
  })
}
const HANDLE = 12 // the tip's handle, a small dot the person drags
const placed = new Map() // handle id -> where the app last put it
function updateArms() {
  const byId = new Map(live().map((e) => [e.id, e]))
  // A question or answer the person deleted takes its whole exchange with it
  // (R13.5).
  const orphans = new Set()
  for (const e of live()) {
    const g = tag(e)
    if (g?.role === 'arm' && !byId.has(g.of)) orphans.add(g.exchange)
    if (g?.role === 'link' && !(byId.has(e.startBinding?.elementId) && byId.has(e.endBinding?.elementId))) orphans.add(g.exchange)
  }
  if (orphans.size) {
    for (const x of orphans) removeExchange(x)
    return
  }
  const changes = new Map()
  const retarget = new Map()
  for (const b of live()) {
    const g = tag(b)
    if (g?.role !== 'question') continue
    const handle = byId.get(`${b.id}-tip`)
    let tip = g.tip
    // The person dragged the tip's handle: the arm points where they left it,
    // at the shape under it, if any.
    const last = handle && placed.get(handle.id)
    if (handle && last && (Math.abs(handle.x - last.x) > 0.5 || Math.abs(handle.y - last.y) > 0.5)) {
      const p = { x: handle.x + HANDLE / 2, y: handle.y + HANDLE / 2 }
      let under = null
      for (const e of live()) {
        if (tag(e)?.exchange === g.exchange && !tag(e)?.follows || e.containerId || e.id === handle.id) continue
        if (p.x >= e.x && p.x <= e.x + e.width && p.y >= e.y && p.y <= e.y + e.height && (!under || e.width * e.height < under.width * under.height)) under = e
      }
      tip = under ? { target: under.id, fx: (p.x - under.x) / (under.width || 1), fy: (p.y - under.y) / (under.height || 1) } : { x: p.x, y: p.y }
      retarget.set(b.id, tip)
      placed.set(handle.id, { x: handle.x, y: handle.y })
    }
    const target = tip.target ? byId.get(tip.target) : null
    const at = tipOf(tip, target, b)
    const geo = armGeometry(b, at)
    for (const [suffix, pts] of [['wedge', geo?.wedge], ['sides', geo?.sides]]) {
      const arm = byId.get(`${b.id}-${suffix}`)
      if (!arm) continue
      const want = pts ? asLine(pts) : { x: b.x, y: b.y, points: [[0, 0], [0, 0]], width: 0, height: 0 }
      const same = Math.abs(arm.x - want.x) < 0.5 && Math.abs(arm.y - want.y) < 0.5 && JSON.stringify(arm.points.map((q) => q.map(Math.round))) === JSON.stringify(want.points.map((q) => q.map(Math.round)))
      if (!same) changes.set(arm.id, want)
    }
    if (handle && !retarget.has(b.id)) {
      const want = { x: at.x - HANDLE / 2, y: at.y - HANDLE / 2 }
      if (Math.abs(handle.x - want.x) > 0.5 || Math.abs(handle.y - want.y) > 0.5) changes.set(handle.id, want)
      placed.set(handle.id, want)
    }
  }
  for (const [bid, tip] of retarget) {
    const b = byId.get(bid)
    changes.set(bid, { customData: { garnet: { ...tag(b), tip } } })
  }
  if (changes.size) patch(new Set(changes.keys()), (e) => changes.get(e.id))
  if (retarget.size) queueArms()
}

function hideMenu() {
  if (menuEl) menuEl.hidden = true
}
function showMenu(ev, items) {
  menuEl.replaceChildren(
    ...items.map(([label, fn]) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', () => {
        hideMenu()
        fn()
      })
      return b
    }),
  )
  const r = overlayEl.getBoundingClientRect()
  menuEl.style.left = `${ev.clientX - r.left}px`
  menuEl.style.top = `${ev.clientY - r.top}px`
  menuEl.hidden = false
}

// The right-click menu: Add question, and Remove this exchange on any piece
// of one; "More…" opens the editor's own menu.
function onContextMenu(ev) {
  if (ev.garnetPass || !api) return
  ev.preventDefault()
  ev.stopPropagation()
  const p = toScene(ev.clientX, ev.clientY)
  const target = hit(p)
  const g = tag(target)
  const items = []
  if (g?.role === 'answer') items.push(['Add question', () => typeQuestion(p, target, true)])
  else items.push(['Add question', () => typeQuestion(p, target, false)])
  if (g?.exchange) items.push(['Remove this exchange', () => removeExchange(g.exchange)])
  items.push([
    'More…',
    () => {
      const again = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY, button: 2 })
      again.garnetPass = true
      ev.target.dispatchEvent(again)
    },
  ])
  showMenu(ev, items)
}

// A balloon to type into, over the board, until Enter (send) or Escape.
function typeQuestion(p, target, follow) {
  const anchor = follow ? { x: target.x - 40, y: target.y + target.height + 50 } : { x: p.x + 60, y: p.y - 150 }
  const at = toClient(anchor)
  const r = overlayEl.getBoundingClientRect()
  const box = document.createElement('textarea')
  box.className = 'question-typing'
  box.placeholder = follow ? 'Your follow-up, then Enter' : 'Your question, then Enter'
  box.style.left = `${at.x - r.left}px`
  box.style.top = `${at.y - r.top}px`
  overlayEl.append(box)
  // While the question is typed, its arm is drawn already, to what it points at.
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('class', 'question-typing-arm')
  const path = document.createElementNS(svgNS, 'path')
  svg.append(path)
  overlayEl.append(svg)
  const pointAt = follow ? toClient(tipOf({ edge: true }, target, { ...anchor, width: 240, height: 70 })) : toClient(p)
  const drawArm = () => {
    const b = box.getBoundingClientRect()
    const rect = { x: b.left - r.left, y: b.top - r.top, width: b.width, height: b.height }
    const geo = armGeometry(rect, { x: pointAt.x - r.left, y: pointAt.y - r.top })
    path.setAttribute('d', geo ? `M${geo.wedge.map((q) => `${q.x} ${q.y}`).join(' L')} Z` : '')
  }
  drawArm()
  box.addEventListener('input', drawArm)
  box.focus()
  const close = () => {
    box.remove()
    svg.remove()
  }
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return close()
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    const text = box.value.trim()
    if (!text) return setStatus('Type a question first, or Escape to discard it.', true)
    close()
    askQuestion(text, anchor, p, target, follow)
  })
  box.addEventListener('blur', () => setTimeout(close, 150))
}

async function askQuestion(text, anchor, p, target, follow) {
  const g = tag(target)
  const exchange = follow ? g.exchange : uid('x')
  const qid = uid('q')
  const bid = `b-${qid}`
  const tip = follow ? { target: target.id, edge: true } : target ? { target: target.id, fx: (p.x - target.x) / (target.width || 1), fy: (p.y - target.y) / (target.height || 1) } : { x: p.x, y: p.y }
  applyRequest({ add: [{ id: bid, kind: 'rectangle', text, x: anchor.x, y: anchor.y, width: 240, height: 70 }] }, { fit: false })
  const made = new Map(live().map((e) => [e.id, e]))
  const textId = (made.get(bid)?.boundElements ?? []).find((b) => b.type === 'text')?.id
  const arms = convertToExcalidrawElements(
    [
      { type: 'line', id: `${bid}-wedge`, x: anchor.x, y: anchor.y, points: [[0, 0], [1, 1], [0, 0]], strokeColor: 'transparent', backgroundColor: QC.fill, fillStyle: 'solid', ...PLAIN },
      { type: 'line', id: `${bid}-sides`, x: anchor.x, y: anchor.y, points: [[0, 0], [1, 1]], strokeColor: QC.line, strokeWidth: 2, ...PLAIN },
    ],
    { regenerateIds: false },
  ).map((e) => ({ ...e, locked: true, customData: { garnet: { role: 'arm', of: bid, exchange } } }))
  // The tip's handle: the one piece of the arm the person moves.
  const [handle] = convertToExcalidrawElements([{ type: 'ellipse', id: `${bid}-tip`, x: p.x - HANDLE / 2, y: p.y - HANDLE / 2, width: HANDLE, height: HANDLE, strokeColor: QC.line, backgroundColor: QC.line, fillStyle: 'solid', ...PLAIN }], { regenerateIds: false })
  arms.push({ ...handle, customData: { garnet: { role: 'tip', of: bid, exchange } } })
  elements = elements.concat(arms)
  patch(new Set([bid, textId]), (e) =>
    e.id === bid
      ? { strokeColor: QC.line, backgroundColor: QC.fill, fillStyle: 'solid', strokeWidth: 2, roundness: { type: 3 }, customData: { garnet: { role: 'question', qid, exchange, tip } } }
      : { strokeColor: QC.ink, customData: { garnet: { role: 'question-text', exchange } } },
  )
  updateArms()
  const about = follow ? `your answer to ${g.qid}` : target ? describeShape(target) : `a spot on the board at (${Math.round(p.x)}, ${Math.round(p.y)})`
  const picture = await pictureOf(follow ? target : target ?? { x: p.x - 200, y: p.y - 150, width: 400, height: 300 }, qid)
  // A question waits, with the board marked as being edited, until the
  // person presses Review, which sends it.
  const q = { id: qid, exchange, text, about, picture, follows: follow ? g.qid : null, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), status: 'draft' }
  setState({ questions: [...(boardState.questions ?? []), q], editing: true })
  setStatus('Question added. Press Review when you are done, to send it to the agent.')
}

function describeShape(e) {
  const textEl = (e.boundElements ?? []).map((b) => elements.find((x) => x.id === b.id)).find((x) => x?.type === 'text')
  const words = textEl ? ` "${(textEl.originalText ?? textEl.text).replace(/\n/g, ' ').slice(0, 80)}"` : ''
  return `[${e.id}] ${e.type}${words}`
}

// A picture of the area round what the question points at (R13.2).
async function pictureOf(area, qid) {
  try {
    const pad = 60
    const box = { x: area.x - pad, y: area.y - pad, w: area.width + 2 * pad, h: area.height + 2 * pad }
    const near = live().filter((e) => e.x < box.x + box.w && e.x + e.width > box.x && e.y < box.y + box.h && e.y + e.height > box.y)
    const blob = await exportToBlob({ elements: near, files: api.getFiles(), appState: { exportBackground: true, viewBackgroundColor: GROUND, exportWithDarkMode: false }, mimeType: 'image/png' })
    return await window.garnet.board.picture(qid, new Uint8Array(await blob.arrayBuffer()))
  } catch {
    return null
  }
}

// Places the agent's answers as notes joined to their questions (R13.3).
function placeAnswers(state) {
  if (!api) return
  for (const q of state.questions ?? []) {
    if (q.status !== 'answered' || !q.answer) continue
    if (live().some((e) => tag(e)?.role === 'answer' && tag(e).qid === q.id)) continue
    const b = live().find((e) => tag(e)?.role === 'question' && tag(e).qid === q.id)
    if (!b) continue
    const nid = `a-${q.id}`
    applyRequest({ add: [{ id: nid, kind: 'rectangle', text: `Claude: ${q.answer}`, x: b.x + 40, y: b.y + b.height + 40, width: 260, height: 70 }, { kind: 'line', from: b.id, to: nid }] }, { fit: false })
    const link = live().find((e) => e.type === 'line' && e.startBinding?.elementId === b.id && e.endBinding?.elementId === nid)
    const note = live().find((e) => e.id === nid)
    const textId = (note?.boundElements ?? []).find((x) => x.type === 'text')?.id
    patch(new Set([nid, link?.id, textId].filter(Boolean)), (e) =>
      e.id === nid
        ? { strokeColor: AC.line, backgroundColor: AC.fill, fillStyle: 'solid', strokeWidth: 2, customData: { garnet: { role: 'answer', qid: q.id, exchange: q.exchange } } }
        : e.id === textId
          ? { strokeColor: AC.ink, customData: { garnet: { role: 'answer-text', exchange: q.exchange } } }
          : { strokeColor: AC.line, strokeWidth: 2, customData: { garnet: { role: 'link', exchange: q.exchange } } },
    )
  }
}

// Removes every balloon, answer and link of an exchange at once (R13.5).
function removeExchange(exchange, { byAgent = false } = {}) {
  const gone = new Set(live().filter((e) => tag(e)?.exchange === exchange).map((e) => e.id))
  for (const e of live()) if (e.containerId && gone.has(e.containerId)) gone.add(e.id)
  if (!gone.size) return 0
  replaceScene(elements.map((e) => (gone.has(e.id) ? bump(e, { isDeleted: true }) : e)))
  setState({ questions: (boardState.questions ?? []).filter((q) => q.exchange !== exchange) })
  if (!byAgent) setStatus('Exchange removed.')
  return gone.size
}

export async function mountBoard(container) {
  const info = await window.garnet.board.open()
  // The header: where the agent finds the rendition and writes requests.
  const head = document.createElement('div')
  head.className = 'board-head'
  const paths = document.createElement('span')
  paths.className = 'board-paths mono'
  paths.textContent = info.inheritedFrom ? `Continued from session ${info.inheritedFrom.slice(0, 8)} · ${info.paths.rendition}` : `${info.paths.rendition}`
  paths.title = 'The rendition the agent reads; it changes the board by writing a request beside it.'
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = 'Copy the board’s path for the agent'
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(`The shared board's rendition is ${info.paths.rendition}; read it, and change the board by writing ${info.paths.request} as its header describes.`)
    setStatus('Copied.')
  })
  statusEl = document.createElement('span')
  statusEl.className = 'board-status'
  // Editing: checked by any change the person makes, unchecked by them when
  // done. Review: the person asks the agent to read the board; the agent's
  // "reviewed" turns it off.
  const editing = document.createElement('label')
  editing.className = 'board-editing'
  editingBox = document.createElement('input')
  editingBox.type = 'checkbox'
  editingBox.addEventListener('change', () => setState({ editing: editingBox.checked }))
  editing.append(editingBox, document.createTextNode(' Editing'))
  reviewButton = document.createElement('button')
  reviewButton.type = 'button'
  reviewButton.className = 'board-review'
  reviewButton.textContent = 'Review'
  // Asking for a review ends editing.
  // Review also sends the questions added since the last one (R13.2).
  reviewButton.addEventListener('click', () =>
    setState(boardState.review ? { review: false } : { review: true, editing: false, questions: (boardState.questions ?? []).map((q) => (q.status === 'draft' ? { ...q, status: 'open' } : q)) }),
  )
  // Fit: zooms and scrolls so that the whole drawing is in view.
  const fit = document.createElement('button')
  fit.type = 'button'
  fit.className = 'board-fit'
  fit.textContent = 'Fit'
  fit.title = 'Zoom to fit the whole board (Shift+1)'
  fit.addEventListener('click', () => api?.scrollToContent(undefined, { fitToContent: true, animate: true }))
  const signals = document.createElement('span')
  signals.className = 'board-signals'
  signals.append(editing, reviewButton, fit)
  head.append(signals, paths, copy, statusEl)
  showState(info.state ?? boardState)
  window.garnet.board.onState(showState)
  const holder = document.createElement('div')
  holder.className = 'board-canvas'
  holderEl = holder
  overlayEl = container
  container.style.position = 'relative'
  menuEl = document.createElement('div')
  menuEl.className = 'board-menu'
  menuEl.hidden = true
  holder.addEventListener('contextmenu', onContextMenu, true)
  container.addEventListener('pointerdown', (e) => !menuEl.contains(e.target) && hideMenu(), true)
  container.replaceChildren(head, holder, menuEl)

  elements = info.scene?.elements ? restoreElements(info.scene.elements, null) : []
  initialFiles = info.scene?.files ?? {}
  const convert = info.scene && (info.scene.style !== 'plain' || elements.some(offStyle))
  // A change of face changes the text's measured size, so it is remeasured.
  if (convert) elements = restoreElements(straighten(toPlain(elements)), null, { refreshDimensions: true })
  savedVersion = convert ? -1 : getSceneVersion(elements)
  knownVersion = getSceneVersion(elements)

  window.garnet.board.onRequest(async ({ request, error }) => {
    if (error) return setStatus(error, true)
    await sizeImages(request)
    const d = applyRequest(request)
    window.garnet.board.outcome({ requestId: request.requestId ?? null, added: d.added, relabelled: d.relabelled, removed: d.removed, problems: d.problems })
    setStatus(`The agent ${[d.added && `added ${d.added}`, d.relabelled && `relabelled ${d.relabelled}`, d.removed && `removed ${d.removed}`].filter(Boolean).join(', ') || 'changed nothing'}.${d.problems.length ? ` Problems: ${d.problems.join('; ')}.` : ''}`, d.problems.length > 0)
  })
  window.garnet.board.onExternal((incoming) => mergeExternal(incoming))

  createRoot(holder).render(
    React.createElement(Excalidraw, {
      // Requests are applied to the mounted editor only: until then the main
      // process keeps them on disk.
      excalidrawAPI: (a) => {
        const first = !api
        api = a
        if (first) {
          window.garnet.board.ready()
          queueMicrotask(() => placeAnswers(boardState))
          // Arms left by an exchange deleted before this version are cleared.
          queueArms()
        }
        if (first && convert) scheduleSave()
      },
      initialData: { elements, files: initialFiles, appState: { theme: 'dark', viewBackgroundColor: GROUND, ...PLAIN_APP_STATE }, scrollToContent: true },
      theme: 'dark',
      onChange: (els) => {
        elements = els
        // A change the app did not make is the person's: they are editing.
        const v = getSceneVersion(els)
        if (v !== knownVersion) {
          knownVersion = v
          if (!boardState.editing) setState({ editing: true })
        }
        // Pasted elements may come in another style; they are given the board's.
        if (els.some((e) => !e.isDeleted && offStyle(e))) queueMicrotask(() => replaceScene(restoreElements(straighten(elements), null, { refreshDimensions: true })))
        queueArms()
        scheduleSave()
      },
      // The board's own controls: no style choices beyond colour, stroke and edges.
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false }, tools: { image: true } },
    }),
  )
}
