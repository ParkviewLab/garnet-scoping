// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Speech through phonorheos (R22, P18). phonorheos is reached over its local
// Unix socket only, a file on this machine: never its TCP port or its LAN
// listener, so the app still makes no network connection (R5.4). The app
// sends every event whatever phonorheos's mute; muting is phonorheos's own
// concern (R22.5).

import http from 'node:http'
import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const CLIENT = 'garnet-scoping'
const CHECK_MS = 30_000
const BURST_MS = 1500

export function socketPath(env = process.env, platform = process.platform) {
  if (env.PHONORHEOS_SOCKET) return env.PHONORHEOS_SOCKET
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'phonorheos', 'phonorheos.sock')
  // Linux: in the runtime folder, else in phonorheos's data folder.
  if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, 'phonorheos', 'phonorheos.sock')
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'phonorheos', 'phonorheos.sock')
}

// One HTTP request over the socket; resolves { status, body } or rejects.
export function request(sock, method, path, body = null, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request(
      { socketPath: sock, method, path, timeout, headers: { host: 'localhost', ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// The voices phonorheos lists (GET /voices, phonorheos 0.11 and later), each
// { id, label, default }; [] where it gives none.
export function parseVoices(body) {
  let d
  try {
    d = JSON.parse(body)
  } catch {
    return []
  }
  const list = Array.isArray(d) ? d : Array.isArray(d?.voices) ? d.voices : []
  return list
    .map((v) => (typeof v === 'string' ? { id: v } : v))
    .filter((v) => v && typeof v.id === 'string' && /^[a-z]{1,3}_[a-z0-9]+$/.test(v.id))
    .map((v) => {
      // An accent is a proper adjective ("British"); a gender is not.
      const accent = typeof v.accent === 'string' && v.accent ? v.accent[0].toUpperCase() + v.accent.slice(1) : null
      const gender = typeof v.gender === 'string' && v.gender ? v.gender.toLowerCase() : null
      const extra = [accent, gender].filter(Boolean).join(', ')
      const name = typeof v.name === 'string' && v.name ? v.name : v.id
      return { id: v.id, name, label: extra ? `${name} (${extra})` : name, default: v.default === true || v.selected === true }
    })
}

// The sentence for a burst of events (R22.5): one event is said as it is; several
// are named together in one sentence, by kind.
const KIND = {
  waiting: { one: (e) => `${e.title} is waiting${e.why ? `: ${e.why}` : ''}.`, many: 'waiting' },
  finished: { one: (e) => `${e.title} has finished; your turn.`, many: 'finished their turns' },
  board: { one: (e) => `${e.title} answered ${e.what ?? 'you'} on the board.`, many: 'answered on the board' },
}
const WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const list = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`)
export function sentence(events) {
  if (!events.length) return ''
  if (events.length === 1) return KIND[events[0].kind].one(events[0])
  const parts = []
  for (const kind of Object.keys(KIND)) {
    const of = events.filter((e) => e.kind === kind)
    if (!of.length) continue
    if (of.length === 1) parts.push(KIND[kind].one(of[0]).replace(/\.$/, ''))
    else parts.push(`${WORDS[of.length] ?? of.length} sessions ${KIND[kind].many}: ${list(of.map((e) => e.title))}`)
  }
  return `${parts.join('; ')}.`
}

// Why a session waits, as the Sessions panel names it (R8.4), for speech.
export function whyWaiting(reason) {
  if (!reason) return ''
  if (reason.type === 'permission') return `permission to ${String(reason.text).replace(/^./, (c) => c.toLowerCase())}`
  if (reason.type === 'question') return `a question, ${reason.text}`
  if (reason.type === 'next-step') return `asked, ${reason.text}`
  if (reason.type === 'hold') return 'on hold'
  return ''
}

// The events A and B (R22.2) between two maps of live states: a session that
// has just begun waiting for the person, or has just finished its turn. The
// first map seen gives none, so nothing is announced at start-up.
export function transitions(prev, next, titleOf) {
  if (!prev) return []
  const out = []
  for (const [id, st] of Object.entries(next)) {
    const was = prev[id]
    if (!was || !st) continue
    const title = titleOf(id)
    if (!title) continue
    if (st.state === 'waiting' && was.state !== 'waiting' && st.reason?.type !== 'hold') out.push({ kind: 'waiting', id, title, why: whyWaiting(st.reason) })
    else if (st.state === 'idle' && st.yourTurn && !(was.state === 'idle' && was.yourTurn)) out.push({ kind: 'finished', id, title })
  }
  return out
}

// The speech service: keeps knowing whether phonorheos runs, and speaks.
// `settings()` gives the current settings; `onStatus(status)` is told each
// change of what was found.
export function createSpeech({ settings, onStatus = () => {}, sock = socketPath() }) {
  let status = { available: false, version: null, voices: [] }
  let voicesFor = null
  let burst = []
  let burstTimer = null
  let watcher = null

  const publish = (next) => {
    const changed = JSON.stringify(next) !== JSON.stringify(status)
    status = next
    if (changed) onStatus(status)
  }

  async function check() {
    try {
      const health = await request(sock, 'GET', '/health')
      if (health.status !== 200) throw new Error('unhealthy')
      const st = JSON.parse((await request(sock, 'GET', '/status')).body)
      const version = typeof st?.version === 'string' ? st.version : null
      // The voices are asked for once per version phonorheos reports.
      let voices = status.voices
      if (voicesFor !== version) {
        const r = await request(sock, 'GET', '/voices').catch(() => null)
        voices = r?.status === 200 ? parseVoices(r.body) : []
        voicesFor = version
      }
      publish({ available: true, version, ready: st?.voice?.state === 'ready', voices })
    } catch {
      voicesFor = null
      publish({ available: false, version: null, voices: [] })
    }
    rewatch()
  }

  // The folder holding the socket is watched, so that phonorheos starting or
  // quitting is seen at once; where it does not exist yet, the 30-second
  // check finds phonorheos when it appears.
  function rewatch() {
    if (watcher) return
    const dir = dirname(sock)
    stat(dir)
      .then(() => {
        if (watcher) return
        try {
          watcher = watch(dir, (_ev, name) => {
            if (!name || name === 'phonorheos.sock' || sock.endsWith(name)) setTimeout(check, 300)
          })
          watcher.on('error', () => {
            watcher?.close()
            watcher = null
          })
        } catch {
          watcher = null
        }
      })
      .catch(() => {})
  }

  async function say(text) {
    const t = String(text ?? '').trim()
    if (!t || !status.available) return false
    const voice = settings().speech?.voice
    try {
      const r = await request(sock, 'POST', '/speak', { text: t.slice(0, 20_000), client: CLIENT, ...(voice ? { voice } : {}) })
      return r.status >= 200 && r.status < 300
    } catch {
      check()
      return false
    }
  }

  const stop = () => request(sock, 'POST', '/stop', {}).then(() => true, () => false)

  // An event A, B or D, spoken if its setting is on; events that arrive
  // within 1.5 seconds of each other are said in one sentence (R22.5).
  const SETTING = { waiting: 'waiting', finished: 'finished', board: 'board' }
  function event(e) {
    if (!settings().speech?.[SETTING[e.kind]]) return
    if (burst.some((b) => b.kind === e.kind && b.id === e.id)) return
    burst.push(e)
    clearTimeout(burstTimer)
    burstTimer = setTimeout(() => {
      const said = sentence(burst)
      burst = []
      say(said)
    }, BURST_MS)
  }

  const timer = setInterval(check, CHECK_MS)
  timer.unref?.()
  check()
  return { check, say, stop, event, status: () => status, close: () => (clearInterval(timer), watcher?.close()) }
}
