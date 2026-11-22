// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sentence, whyWaiting, transitions, parseVoices, socketPath, createSpeech, CLIENT } from '../src/main/speech.js'

describe('sentence', () => {
  it('says one event as it is', () => {
    expect(sentence([{ kind: 'waiting', title: 'A', why: 'permission to run npm test' }])).toBe('A is waiting: permission to run npm test.')
    expect(sentence([{ kind: 'finished', title: 'B' }])).toBe('B has finished; your turn.')
    expect(sentence([{ kind: 'board', title: 'C', what: 'your question' }])).toBe('C answered your question on the board.')
  })
  it('names a burst together in one sentence (R22.5)', () => {
    const w = (t) => ({ kind: 'waiting', title: t })
    expect(sentence([w('A'), w('B'), w('C')])).toBe('Three sessions waiting: A, B, and C.')
    expect(sentence([w('A'), { kind: 'finished', title: 'B' }])).toBe('A is waiting; B has finished; your turn.')
  })
})

describe('whyWaiting', () => {
  it('names a permission, a question and an ask, never a raw command', () => {
    expect(whyWaiting({ type: 'permission', text: 'Run npm test' })).toBe('permission to run npm test')
    expect(whyWaiting({ type: 'question', text: 'Which map size?' })).toBe('a question, Which map size?')
    expect(whyWaiting(null)).toBe('')
  })
})

describe('transitions', () => {
  const title = (id) => ({ a: 'Alpha', b: 'Beta' })[id]
  it('announces nothing at start-up', () => {
    expect(transitions(null, { a: { state: 'waiting' } }, title)).toEqual([])
  })
  it('finds a session that began waiting, or finished its turn, once', () => {
    const prev = { a: { state: 'working' }, b: { state: 'working' } }
    const next = { a: { state: 'waiting', reason: { type: 'permission', text: 'Edit README.md' } }, b: { state: 'idle', yourTurn: true } }
    expect(transitions(prev, next, title)).toEqual([
      { kind: 'waiting', id: 'a', title: 'Alpha', why: 'permission to edit README.md' },
      { kind: 'finished', id: 'b', title: 'Beta' },
    ])
    expect(transitions(next, next, title)).toEqual([])
  })
  it('does not announce a hold the person asked for', () => {
    expect(transitions({ a: { state: 'working' } }, { a: { state: 'waiting', reason: { type: 'hold' } } }, title)).toEqual([])
  })
})

describe('parseVoices', () => {
  it('reads a list of voices, by object or by name, and marks the default', () => {
    const v = parseVoices(JSON.stringify({ default: 'bm_lewis', voices: [{ id: 'bm_lewis', name: 'Lewis', accent: 'british', gender: 'male', default: true }, 'af_heart', { id: '../bad' }] }))
    expect(v).toEqual([
      { id: 'bm_lewis', name: 'Lewis', label: 'Lewis (British, male)', default: true },
      { id: 'af_heart', name: 'af_heart', label: 'af_heart', default: false },
    ])
    expect(parseVoices('not json')).toEqual([])
  })
})

describe('socketPath', () => {
  it('follows phonorheos: the override, the runtime folder, else its data folder', () => {
    expect(socketPath({ PHONORHEOS_SOCKET: '/x.sock' }, 'linux')).toBe('/x.sock')
    expect(socketPath({ XDG_RUNTIME_DIR: '/run/user/1' }, 'linux')).toBe('/run/user/1/phonorheos/phonorheos.sock')
    expect(socketPath({}, 'darwin')).toMatch(/Library\/Application Support\/phonorheos\/phonorheos\.sock$/)
  })
})

// A stand-in phonorheos on a socket of its own.
let server = null
let dir = null
afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r()))
  server = null
  if (dir) await rm(dir, { recursive: true, force: true })
})
async function fake({ voices = true } = {}) {
  dir = await mkdtemp(join(tmpdir(), 'garnet-speech-'))
  const sock = join(dir, 'phonorheos.sock')
  const spoken = []
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.url === '/health') return res.end('ok')
      if (req.url === '/status') return res.end(JSON.stringify({ version: '0.11.0', voice: { state: 'ready' }, muted: true }))
      if (req.url === '/voices' && voices) return res.end(JSON.stringify({ voices: [{ id: 'bf_emma', name: 'Emma', default: false }] }))
      if (req.url === '/speak') {
        spoken.push(JSON.parse(body))
        return res.end('{"queued":1}')
      }
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise((r) => server.listen(sock, r))
  return { sock, spoken }
}
const until = async (f, ms = 3000) => {
  const t = Date.now()
  while (!f()) {
    if (Date.now() - t > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('createSpeech', () => {
  it('finds phonorheos and its voices, and speaks even while it is muted (R22.5)', async () => {
    const { sock, spoken } = await fake()
    const sp = createSpeech({ sock, settings: () => ({ speech: { voice: 'bf_emma' } }) })
    await until(() => sp.status().available)
    expect(sp.status()).toMatchObject({ available: true, version: '0.11.0', voices: [{ id: 'bf_emma', name: 'Emma', label: 'Emma' }] })
    expect(await sp.say('Hello.')).toBe(true)
    expect(spoken).toEqual([{ text: 'Hello.', client: CLIENT, voice: 'bf_emma' }])
    sp.close()
  })
  it('offers no voices where phonorheos lists none (R22.4)', async () => {
    const { sock } = await fake({ voices: false })
    const sp = createSpeech({ sock, settings: () => ({ speech: {} }) })
    await until(() => sp.status().available)
    expect(sp.status().voices).toEqual([])
    sp.close()
  })
  it('says a burst once, and only for a feature that is on', async () => {
    const { sock, spoken } = await fake()
    const sp = createSpeech({ sock, settings: () => ({ speech: { waiting: true, finished: false } }) })
    await until(() => sp.status().available)
    sp.event({ kind: 'waiting', id: 'a', title: 'A' })
    sp.event({ kind: 'waiting', id: 'b', title: 'B' })
    sp.event({ kind: 'finished', id: 'c', title: 'C' })
    await until(() => spoken.length === 1)
    expect(spoken[0].text).toBe('Two sessions waiting: A and B.')
    sp.close()
  })
  it('reports phonorheos absent where its socket is', async () => {
    dir = await mkdtemp(join(tmpdir(), 'garnet-speech-'))
    const sp = createSpeech({ sock: join(dir, 'none.sock'), settings: () => ({ speech: {} }) })
    await new Promise((r) => setTimeout(r, 200))
    expect(sp.status().available).toBe(false)
    expect(await sp.say('Hello.')).toBe(false)
    sp.close()
  })
})
