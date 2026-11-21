// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The main process. It finds the session transcripts (R1), follows the one
// each session window shows (R1.3), lists the session's memory store (R4),
// and refuses every network request (R5.4). It never writes under the Claude
// configuration directory (R5.1).

import { app, BrowserWindow, ipcMain, session, shell, Menu } from 'electron'
import { join, resolve, sep, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { watch, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { listSessions } from './transcript/sessions.js'
import { listMemory } from './transcript/memory.js'
import { follow } from './follower.js'
import { openBoard, inheritBoard } from './board.js'
import { openAboutWindow, openLicensesWindow } from './about.js'
import { loadSettings, saveSettings, clean } from './settings.js'
import { openSetupInfo, installChannel, installPlugin } from './setupInfo.js'
import { pluginStatus } from './plugin.js'
import { watchLive } from './live/index.js'
import { pendingFromTail, sessionState, waitingCount } from './live/state.js'
import { readEdge, readFrom } from './transcript/reader.js'
import { createSession, snapshot } from './transcript/session.js'
import { classify } from './transcript/records.js'
import { boardPaths, cleanState, BOARDS } from './board.js'
import { parseWork, nextRun } from './work.js'
import { DEMO_ID, listLessons, prepareDemo, agentStep, demoList, demoState } from './manual.js'

const CLAUDE = join(homedir(), '.claude')
const PROJECTS = join(CLAUDE, 'projects')
const LIVE_DIR = join(CLAUDE, 'sessions')
const TAIL = 64 * 1024
const PUSH_MS = 400
// Files the preview shows as text.
const TEXT_FILE = /\.(md|markdown|txt|text|log|json|csv|tsv|ya?ml|toml|ini|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|rs|go|java|kt|swift|c|h|cpp|sh|zsh|sql)$/i

let listWindow = null
let settingsWindow = null
let settingsFile = null
let settings = null
const windows = new Map() // session id -> { win, follower, project }
let known = [] // the session list, as listSessions gives it
let liveFacts = { available: true, bySession: {} }
let live = { available: true, states: {} }
let liveTimer = null
let demo = null // the manual's current copy of the demo (prepareDemo)
// The manual's lessons and demo (R18): shipped in the app's resources, and
// copied for each lesson into the app's own folder.
const MANUAL_SRC = () => (app.isPackaged ? join(process.resourcesPath, 'manual') : join(__dirname, '../../manual'))
const DEMO_DIR = () => join(app.getPath('userData'), 'manual-demo')

function pageUrl(page, query = {}) {
  const q = new URLSearchParams(query).toString()
  if (process.env.ELECTRON_RENDERER_URL) return { url: `${process.env.ELECTRON_RENDERER_URL}/${page}.html${q ? `?${q}` : ''}` }
  return { file: join(__dirname, `../renderer/${page}.html`), query }
}

function load(win, page, query) {
  const target = pageUrl(page, query)
  if (target.url) win.loadURL(target.url)
  else win.loadFile(target.file, { query: target.query })
}

// plugins: Chromium's own PDF viewer, for previews of delivered PDFs.
const webPreferences = () => ({ preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, plugins: true })

// With no session on the machine, the app shows a window that says so; the
// session list is otherwise a panel of the session window (R8.6).
function createListWindow() {
  if (listWindow && !listWindow.isDestroyed()) return listWindow.focus()
  listWindow = new BrowserWindow({ width: 980, height: 760, title: 'garnet-scoping', backgroundColor: '#17181a', webPreferences: webPreferences() })
  load(listWindow, 'index')
  listWindow.on('closed', () => (listWindow = null))
}

// At start, and from File > Sessions: a window on the most recently active
// session with the Sessions panel on, or the front window with the panel
// turned on.
async function showSessions() {
  const front = BrowserWindow.getFocusedWindow() ?? [...windows.values()].find((w) => !w.win.isDestroyed())?.win
  if (front && [...windows.values()].some((w) => w.win === front)) {
    front.focus()
    return front.webContents.send('panel:show', 'sessions')
  }
  known = await listSessions(PROJECTS)
  if (!known.length) return createListWindow()
  openSession(known[0], { sessions: true })
}

// A session's window: its Desk and its board.
// The manual's window is such a window on a copy of the demo session (`demo`),
// whose board, memory and work files are in that copy (`info.dirs`).
function openSession(info, { sessions = false, demo = false, query = {}, bounds = null } = {}) {
  const open = windows.get(info.id)
  if (open && !open.win.isDestroyed()) return open.win.focus()
  const win = new BrowserWindow({ width: 1400, height: 900, ...(bounds ?? {}), title: info.title ?? info.id, backgroundColor: '#17181a', webPreferences: webPreferences() })
  let timer = null
  const push = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      if (!win.isDestroyed()) win.webContents.send('session:changed')
    }, PUSH_MS)
  }
  const follower = follow(info.id, info.file, push)
  const send = (channel, payload) => !win.isDestroyed() && win.webContents.send(channel, payload)
  const dirs = info.dirs ?? { boards: BOARDS, memory: join(PROJECTS, info.project ?? '', 'memory') }
  const entry = { win, follower, board: null, project: info.project, file: info.file, dirs, demo }
  // A session that continues an earlier one takes over its board first
  // (inheritBoard); the board is opened once that is settled.
  entry.boardReady = follower.ready
    .then(() => (demo ? null : inheritBoard(info.id, follower.view().lineage)))
    .catch(() => null)
    .then(() => {
      entry.board = openBoard(info.id, {
        title: info.title,
        dir: dirs.boards,
        onRequest: (r) => send('board:request', r),
        onExternal: (elements) => send('board:external', elements),
        onPending: () => send('board:pending'),
        onDelivery: (d) => send('board:delivery', d),
        onState: (state) => {
          send('board:state', state)
          updateLive()
        },
      })
      if (win.isDestroyed()) entry.board.close()
      return entry.board
    })
  windows.set(info.id, entry)
  load(win, 'session', { id: info.id, ...(sessions ? { sessions: '1' } : {}), ...query })
  // A link in rendered text opens in the system's browser; the window itself
  // never navigates away from the app's page.
  const openLink = (url) => /^https?:/i.test(url) && shell.openExternal(url)
  win.webContents.setWindowOpenHandler(({ url }) => (openLink(url), { action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    openLink(url)
  })
  win.on('closed', () => {
    entry.board?.close()
    follower.close()
    windows.delete(info.id)
    entry.onClosed?.()
  })
  return entry
}

// The manual's window (R18.5), beside the window it was called from: a lesson
// to play, or none for the list and the search (R18.10).
async function openManual({ lesson = null, from = null } = {}) {
  const open = windows.get(DEMO_ID)
  if (open && !open.win.isDestroyed()) {
    open.win.focus()
    return open.win.webContents.send('manual:show', { lesson })
  }
  const info = (demo = await prepareDemo(MANUAL_SRC(), DEMO_DIR()))
  const near = from?.getBounds?.()
  const bounds = near ? { x: near.x + 60, y: near.y + 40, width: 1200, height: 820 } : { width: 1200, height: 820 }
  openSession(info, { demo: true, bounds, query: { manual: '1', ...(lesson != null ? { lesson: String(lesson) } : {}) } })
  updateLive()
}

// A lesson's Replay or Back a step: a fresh copy of the demo, in a new window
// where the old one was, which plays the lesson's earlier steps at once.
async function resetManual(lesson, step) {
  const old = windows.get(DEMO_ID)
  const bounds = old && !old.win.isDestroyed() ? old.win.getBounds() : null
  // Every window on the demo goes, the other sessions' included.
  for (const w of [...windows.values()].filter((x) => x.demo && !x.win.isDestroyed())) {
    await new Promise((done) => {
      w.onClosed = done
      w.win.destroy()
    })
  }
  const info = (demo = await prepareDemo(MANUAL_SRC(), DEMO_DIR()))
  openSession(info, { demo: true, bounds, query: { manual: '1', lesson: String(lesson), step: String(step) } })
}

// A subagent's transcript: <session>/subagents/agent-<id>.jsonl beside the
// session's own.
const subagentFile = (sessionFile, agentId) => join(sessionFile.replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId}.jsonl`)
// Each subagent's effort and model, from the last records of its own
// transcript (the session's records carry only the model).
async function withEffort(sessionFile, subs) {
  return Promise.all(
    subs.map(async (s) => {
      if (!s.agentId) return s
      const tail = await readEdge(subagentFile(sessionFile, s.agentId), 16 * 1024, true).catch(() => [])
      const last = tail.map(classify).filter((r) => r.kind === 'assistant').at(-1)
      return { ...s, effort: last?.effort ?? null, model: s.model ?? last?.model ?? null }
    }),
  )
}

// Claude Code's end-of-turn report of the session's background work and
// scheduled jobs (R10), as the watcher's hook keeps it; null where absent.
async function readWork(id, dir = BOARDS) {
  const file = join(dir, `${id}.work.json`)
  try {
    const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
    const work = parseWork(JSON.parse(text), st.mtimeMs)
    if (work) for (const c of work.crons) c.next = nextRun(c.schedule)
    return work
  } catch {
    return null
  }
}

const entryOf = (e) => [...windows.values()].find((w) => w.win.webContents === e.sender)

// A path inside a directory, or null.
function inside(dir, p) {
  const full = resolve(p)
  return full === dir || full.startsWith(dir + sep) ? full : null
}

// The Settings window (one at a time).
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow.focus()
  settingsWindow = new BrowserWindow({ width: 420, height: 230, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, title: 'Settings', backgroundColor: '#17181a', webPreferences: webPreferences() })
  load(settingsWindow, 'settings')
  settingsWindow.on('closed', () => (settingsWindow = null))
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:set', async (_e, next) => {
    settings = clean(next)
    await saveSettings(settingsFile, settings)
    for (const w of windows.values()) if (!w.win.isDestroyed()) w.win.webContents.send('settings:changed', settings)
    return settings
  })
  // The manual's window lists the demo alone, so that a lesson never opens a
  // real session.
  ipcMain.handle('sessions:list', async (e) => {
    const w = entryOf(e)
    if (w?.demo) return demo ? demoList(demo) : []
    return (known = await listSessions(PROJECTS))
  })
  ipcMain.handle('manual:lessons', () => listLessons(MANUAL_SRC()))
  ipcMain.handle('manual:whats-this', () => readFile(join(MANUAL_SRC(), 'whats-this.json'), 'utf8').then(JSON.parse, () => ({ names: {}, prefixes: {} })))
  ipcMain.handle('manual:open', (e, lesson) => openManual({ lesson: Number.isInteger(lesson) ? lesson : null, from: BrowserWindow.fromWebContents(e.sender) }))
  // A lesson's step that opens one of the app's own windows, which a lesson
  // cannot reach from its menu: Set-up Info, or Settings.
  ipcMain.handle('manual:window', (e, name) => {
    if (!entryOf(e)?.demo) return
    if (name === 'setup') openSetupInfo()
    if (name === 'settings') openSettings()
  })
  ipcMain.handle('manual:agent', (e, request) => {
    const w = entryOf(e)
    if (w?.demo && request && typeof request === 'object') return agentStep(w.dirs.boards, request)
  })
  ipcMain.handle('manual:reset', (e, lesson, step) => {
    if (entryOf(e)?.demo && Number.isInteger(lesson) && Number.isInteger(step)) return resetManual(lesson, step)
  })
  ipcMain.handle('live:get', () => live)
  // The manual's demo always shows the notice that the install is stale, for
  // its lesson on updating it (R18.9, lesson 26).
  ipcMain.handle('setup:check', (e) => (entryOf(e)?.demo ? { ok: false, state: 'version', installedVersion: '0.12.0', version: app.getVersion(), earlier: [] } : pluginStatus(app.getVersion())))
  ipcMain.handle('setup:open', () => openSetupInfo())
  // From a window on the demo, only a demo session opens, on the demo's copy.
  ipcMain.handle('sessions:open', (e, info) => {
    if (!entryOf(e)?.demo) return openSession(info)
    const o = demo?.others.find((x) => x.id === info?.id)
    if (info?.id === DEMO_ID) return windows.get(DEMO_ID)?.win.focus()
    if (o) openSession({ id: o.id, file: o.file, project: 'demo', title: o.title, dirs: demo.dirs }, { demo: true, bounds: { width: 1100, height: 760 } })
  })
  ipcMain.handle('session:view', async (e) => {
    const w = entryOf(e)
    if (!w) return null
    await w.follower.ready
    const v = w.follower.view()
    // Each delivered file, with whether it still exists (scratch folders are
    // cleared in time).
    const deliveries = (v.deliveries ?? []).map((d) => ({ ...d, files: d.files.map((p) => ({ path: p, exists: existsSync(p) })) }))
    return { ...v, deliveries, subagents: await withEffort(w.file, v.subagents ?? []), work: await readWork(v.id, w.dirs.boards), project: w.project, demo: w.demo }
  })
  // A subagent's own work (R9.2): its actions, its own subagents and its
  // report, read from its transcript beside the session's.
  ipcMain.handle('subagent:detail', async (e, agentId) => {
    const w = entryOf(e)
    if (!w || typeof agentId !== 'string' || !/^[\w-]+$/.test(agentId)) return null
    const file = subagentFile(w.file, agentId)
    const { records } = await readFrom(file, 0).catch(() => ({ records: [] }))
    const { state, apply } = createSession(agentId)
    for (const r of records) apply(r)
    const v = snapshot(state)
    const actions = v.turns.flatMap((t) => t.items.filter((it) => it.type === 'action')).map(({ id, text, target, at, done, isError }) => ({ id, text, target, at, done, isError }))
    return { actions, subagents: await withEffort(w.file, v.subagents), effort: v.facts.effort, model: v.facts.model }
  })
  ipcMain.handle('session:detail', (e, actionId) => entryOf(e)?.follower.detail(actionId) ?? null)
  ipcMain.handle('memory:list', (e) => {
    const w = entryOf(e)
    return w ? listMemory(w.dirs.memory) : null
  })
  ipcMain.handle('memory:read', async (e, path) => {
    const w = entryOf(e)
    const full = w && inside(w.dirs.memory, path)
    return full && full.endsWith('.md') ? readFile(full, 'utf8') : null
  })
  ipcMain.handle('board:open', async (e) => {
    const w = entryOf(e)
    if (!w) return null
    const board = await w.boardReady
    const scene = await board.load()
    return { paths: board.paths, scene, state: await board.state(), inheritedFrom: scene?.inheritedFrom ?? null }
  })
  // The window may ask for a hold or release one; only the agent confirms it.
  ipcMain.handle('board:set-state', (e, next) => {
    const { hold, ...rest } = next ?? {}
    return entryOf(e)?.boardReady.then((b) => b.setState(hold === 'requested' || hold === 'off' ? { ...rest, hold } : rest))
  })
  ipcMain.handle('session:discuss', (e, op) => entryOf(e)?.boardReady.then((b) => b.discuss(op)))
  ipcMain.handle('board:save', (e, scene) => entryOf(e)?.boardReady.then((b) => b.save(scene)))
  ipcMain.handle('board:ready', (e) => entryOf(e)?.boardReady.then((b) => b.ready()))
  ipcMain.handle('board:outcome', (e, o) => entryOf(e)?.boardReady.then((b) => b.outcome(o)))
  ipcMain.handle('board:delivery', (e) => entryOf(e)?.boardReady.then((b) => b.delivery()))
  ipcMain.handle('board:picture', (e, qid, bytes) => entryOf(e)?.boardReady.then((b) => b.picture(qid, bytes)))
  // Files the agent delivered in this session: opened with their default
  // app, or read for the in-app preview. Only delivered files are served.
  const delivered = (e, p) => {
    const w = entryOf(e)
    return Boolean(w && typeof p === 'string' && (w.follower.view().deliveries ?? []).some((d) => d.files.includes(p)))
  }
  ipcMain.handle('file:open', (e, p) => {
    if (delivered(e, p)) shell.openPath(p)
  })
  ipcMain.handle('file:read', async (e, p) => {
    if (!delivered(e, p)) return null
    const info = await stat(p).catch(() => null)
    if (!info) return { kind: 'gone' }
    if (TEXT_FILE.test(p) && info.size <= 1024 * 1024) return { kind: 'text', text: await readFile(p, 'utf8'), size: info.size }
    return { kind: 'other', size: info.size }
  })
  // Shows a folder or file in the system's file manager (S7); only absolute paths.
  ipcMain.handle('finder:show', (_e, p) => {
    if (typeof p === 'string' && isAbsolute(p)) shell.showItemInFolder(p)
  })
}

// Every request that is not for the app's own files is refused (R5.4),
// before any connection is made. Excalidraw lists a CDN beside the bundled
// copy of each font; those attempts are refused like any other, and the
// bundled copy is the one used.
function refuseNetwork() {
  const dev = process.env.ELECTRON_RENDERER_URL
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    const u = details.url
    const ok = u.startsWith('file:') || u.startsWith('devtools:') || u.startsWith('data:') || u.startsWith('blob:') || (dev && u.startsWith(dev))
    done({ cancel: !ok })
  })
}

// The list follows new and growing transcripts.
function watchProjects() {
  let timer = null
  try {
    watch(PROJECTS, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('sessions:changed')
        updateLive()
      }, 1500)
    })
  } catch {}
}

// Live state (R8): the facts from Claude Code, the transcript's tail of each
// running session (why it waits, R8.4) and the board's hold, turned into a
// state per listed session, sent to every window and counted on the Dock.
async function boardStateOf(id, dir = BOARDS) {
  try {
    return cleanState(JSON.parse(await readFile(boardPaths(id, dir).state, 'utf8')))
  } catch {
    return null
  }
}
async function computeLive() {
  if (!known.length) known = await listSessions(PROJECTS)
  const states = {}
  for (const s of known) {
    const facts = liveFacts.bySession[s.id] ?? null
    let tail = null
    if (facts) tail = pendingFromTail(await readEdge(s.file, TAIL, true).catch(() => []))
    const board = facts ? await boardStateOf(s.id) : null
    states[s.id] = { ...sessionState({ live: facts, available: liveFacts.available, hold: board?.hold ?? 'off', tail }), away: Boolean(board?.away?.on) }
  }
  const n = waitingCount(states)
  // The manual's demo is always at work, and waits only on its own Hold; it is
  // never counted on the Dock.
  const manual = windows.get(DEMO_ID)
  if (manual && !manual.win.isDestroyed()) {
    const board = await boardStateOf(DEMO_ID, manual.dirs.boards)
    states[DEMO_ID] = { ...sessionState({ live: { status: 'busy', since: Date.now() - 60_000 }, hold: board?.hold ?? 'off' }), away: Boolean(board?.away?.on) }
    for (const o of demo?.others ?? []) states[o.id] = demoState(o)
  }
  live = { available: liveFacts.available, states }
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('live:changed', live)
    } catch {} // a window closing as the update goes out
  }
  app.setBadgeCount(n)
}
// At most twice a second, so that a change shows within R8.1's two seconds.
function updateLive() {
  if (liveTimer) return
  liveTimer = setTimeout(() => {
    liveTimer = null
    computeLive().catch(() => {})
  }, 500)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const about = { label: 'About garnet-scoping', click: () => openAboutWindow() }
  const licenses = { label: 'Open Source Licenses…', click: () => openLicensesWindow() }
  const prefs = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() }
  const setupInfo = { label: 'Set-up Info…', click: () => openSetupInfo() }
  // How do I… (R18.10): ⌘? on macOS, F1 on Ubuntu.
  const howDoI = { label: 'How do I…', accelerator: isMac ? 'Cmd+Shift+/' : 'F1', click: () => openManual({ from: BrowserWindow.getFocusedWindow() }) }
  // What's This (R21): ⌥⌘? on macOS, ⇧F1 on Ubuntu; the window's own button does the same.
  const whatsThis = { label: 'What\'s This?', accelerator: isMac ? 'Alt+Cmd+Shift+/' : 'Shift+F1', click: () => BrowserWindow.getFocusedWindow()?.webContents.send('whats-this') }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac
        ? [
            {
              role: 'appMenu',
              submenu: [about, setupInfo, licenses, { type: 'separator' }, prefs, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }],
            },
          ]
        : []),
      // Without macOS's app menu, Settings is in the File menu.
      { label: 'File', submenu: [{ label: 'Sessions', accelerator: 'CmdOrCtrl+L', click: () => showSessions() }, ...(isMac ? [] : [prefs]), { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
      { role: 'windowMenu' },
      { role: 'help', submenu: [howDoI, whatsThis, { type: 'separator' }, setupInfo, about, licenses] },
    ]),
  )
}

app.whenReady().then(() => {
  settingsFile = join(app.getPath('userData'), 'settings.json')
  settings = loadSettings(settingsFile)
  installChannel().catch(() => {})
  installPlugin().catch((err) => console.error('garnet-scoping: the Claude Code plugin was not written:', err))
  refuseNetwork()
  registerIpc()
  buildMenu()
  watchProjects()
  watchLive(LIVE_DIR, (facts) => {
    liveFacts = facts
    updateLive()
  })
  showSessions()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showSessions()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
