// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { parseWork, nextRun } from '../src/main/work.js'
import { createSession, snapshot } from '../src/main/transcript/session.js'
import * as F from './fixtures.js'

describe('parseWork (R10)', () => {
  it('reads the running work and the scheduled jobs of a Stop report', () => {
    const w = parseWork({ hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'local_bash', status: 'running', description: 'Watch CI', command: 'gh run watch' }], session_crons: [{ id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'check CI\nthen report' }] }, 1000)
    expect(w.tasks).toEqual([{ id: 'b1', type: 'local_bash', status: 'running', text: 'Watch CI' }])
    expect(JSON.stringify(w)).not.toContain('gh run watch')
    expect(w.crons[0]).toMatchObject({ schedule: '*/5 * * * *', recurring: true, prompt: 'check CI\nthen report' })
  })
  it('refuses a report it does not recognise', () => expect(parseWork({ hook_event_name: 'Stop' })).toBeNull())
})

describe('nextRun', () => {
  const from = new Date(2026, 10, 14, 14, 2, 30).getTime()
  it('finds the next five-minute mark', () => expect(new Date(nextRun('*/5 * * * *', from)).getMinutes()).toBe(5))
  it('finds a daily time', () => {
    const d = new Date(nextRun('30 9 * * *', from))
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([15, 9, 30])
  })
  it('gives null for a schedule it cannot read', () => expect(nextRun('@daily', from)).toBeNull())
})

describe('wake-ups', () => {
  it('records when a ScheduleWakeup fires', () => {
    const { state, apply } = createSession('s1')
    const call = F.assistant([F.tool('w1', 'ScheduleWakeup', { delaySeconds: 600, reason: 'watching CI', prompt: '/loop check' })])
    apply(call)
    const v = snapshot(state)
    expect(v.wakeups[0]).toMatchObject({ reason: 'watching CI', at: Date.parse(call.timestamp) + 600_000 })
  })
})
