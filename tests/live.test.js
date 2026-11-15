// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSessionFile, parseAgents, pendingFromTail, sessionState, waitingCount } from '../src/main/live/state.js'
import { watchLive } from '../src/main/live/index.js'
import * as F from './fixtures.js'

// A synthetic session file, as Claude Code 2.1.325 writes one.
const file = (extra = {}) => ({ pid: process.pid, sessionId: 'abc', cwd: '/work/demo', kind: 'interactive', status: 'idle', statusUpdatedAt: 1000, ...extra })

describe('parseSessionFile', () => {
  it('reads the facts the app uses', () => {
    expect(parseSessionFile(file({ status: 'waiting', waitingFor: 'permission prompt' }))).toMatchObject({ sessionId: 'abc', status: 'waiting', waitingFor: 'permission prompt', since: 1000, kind: 'interactive' })
  })
  it('marks a background session', () => {
    expect(parseSessionFile(file({ kind: 'bg' })).kind).toBe('background')
  })
  it('refuses a file it does not recognise (R6)', () => {
    expect(parseSessionFile({ pid: 1, sessionId: 'abc', status: 'thinking' })).toBeNull()
    expect(parseSessionFile({ sessionId: 'abc', status: 'idle' })).toBeNull()
    expect(parseSessionFile(null)).toBeNull()
  })
  it('reads the listing in the same shape', () => {
    expect(parseAgents([file({ status: 'busy' }), { pid: 'x' }])).toHaveLength(1)
  })
})

describe('pendingFromTail', () => {
  it('names a permission wait by the call with no result, never its command', () => {
    const t = pendingFromTail([F.assistant([F.tool('t1', 'Bash', { command: 'git push --force', description: 'Push the docs branch' })])])
    expect(t.pending).toMatchObject({ type: 'permission', text: 'Push the docs branch', tool: 'Bash' })
    expect(JSON.stringify(t)).not.toContain('git push')
  })
  it('gives a question with its options', () => {
    const t = pendingFromTail([F.assistant([F.tool('q1', 'AskUserQuestion', { questions: [{ question: 'Which units?', options: [{ label: 'mm' }, { label: 'inches' }] }] })])])
    expect(t.pending).toMatchObject({ type: 'question', text: 'Which units?', options: ['mm', 'inches'] })
  })
  it('forgets a call once its result arrives', () => {
    const t = pendingFromTail([F.assistant([F.tool('t1', 'Read', { file_path: '/a' })]), F.result('t1', 'ok')])
    expect(t.pending).toBeNull()
  })
  it('keeps the next-step question until the person writes', () => {
    const wrap = F.assistant([F.tool('w1', 'mcp__ccd_turn__wrap_up', { recap: 'r', ask: 'Merge it?' })])
    expect(pendingFromTail([wrap]).ask.text).toBe('Merge it?')
    expect(pendingFromTail([wrap, F.human('yes')]).ask).toBeNull()
  })
  it('says whether the agent spoke last', () => {
    expect(pendingFromTail([F.human('hi'), F.assistant([F.text('Done.')])]).spokeLast).toBe(true)
    expect(pendingFromTail([F.assistant([F.text('Done.')]), F.human('hi')]).spokeLast).toBe(false)
  })
})

describe('sessionState', () => {
  const live = parseSessionFile(file())
  it('is unknown when no source can be read', () => expect(sessionState({ available: false }).state).toBe('unknown'))
  it('is not running without a live process', () => expect(sessionState({ live: null }).state).toBe('not-running'))
  it('is working when busy', () => expect(sessionState({ live: { ...live, status: 'busy' } }).state).toBe('working'))
  it('waits, with the reason from the transcript', () => {
    const s = sessionState({ live: { ...live, status: 'waiting', waitingFor: 'permission prompt' }, tail: { pending: { type: 'permission', text: 'Push' } } })
    expect(s).toMatchObject({ state: 'waiting', reason: { type: 'permission', text: 'Push' } })
  })
  it('shows a reason it does not recognise as given', () => {
    expect(sessionState({ live: { ...live, status: 'waiting', waitingFor: 'something new' } }).reason).toEqual({ type: 'other', text: 'something new' })
  })
  it('counts a hold and a next-step question as waiting (R8.2)', () => {
    expect(sessionState({ live, hold: 'holding' })).toMatchObject({ state: 'waiting', reason: { type: 'hold' } })
    expect(sessionState({ live, tail: { ask: { text: 'Merge it?' } } })).toMatchObject({ state: 'waiting', reason: { type: 'next-step' } })
  })
  it('is idle after a turn that simply ended, with your turn beside it', () => {
    expect(sessionState({ live, tail: { spokeLast: true } })).toMatchObject({ state: 'idle', yourTurn: true, since: 1000 })
  })
  it('marks a background session', () => expect(sessionState({ live: { ...live, kind: 'background', status: 'waiting' } }).background).toBe(true))
  it('counts the sessions waiting', () => expect(waitingCount({ a: { state: 'waiting' }, b: { state: 'idle' }, c: { state: 'waiting' } })).toBe(2))
})

describe('watchLive', () => {
  let dir, w
  afterEach(async () => {
    w?.close()
    if (dir) await rm(dir, { recursive: true, force: true })
  })
  const next = () => new Promise((resolve) => (w = watchLive(dir, resolve, { listing: async () => null })))

  it('reads the files of running processes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'garnet-live-'))
    await writeFile(join(dir, `${process.pid}.json`), JSON.stringify(file({ status: 'busy' })))
    const got = await next()
    expect(got.available).toBe(true)
    expect(got.bySession.abc.status).toBe('busy')
  })
  it('ignores a file whose process has gone', async () => {
    dir = await mkdtemp(join(tmpdir(), 'garnet-live-'))
    await writeFile(join(dir, '999999.json'), JSON.stringify(file({ pid: 999999 })))
    const got = await next()
    expect(got.bySession).toEqual({})
  })
  it('falls back to the listing when the folder is missing, and is unavailable when both fail', async () => {
    dir = join(tmpdir(), 'garnet-live-missing-' + process.pid)
    const got = await next()
    expect(got.available).toBe(false)
    const viaListing = await new Promise((resolve) => (w = watchLive(dir, resolve, { listing: async () => JSON.stringify([file({ status: 'waiting' })]) })))
    expect(viaListing).toMatchObject({ available: true, bySession: { abc: { status: 'waiting' } } })
  })
})
