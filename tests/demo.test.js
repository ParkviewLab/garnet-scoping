// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The manual's demo session (R18.5, P16) reads as its lessons need it to:
// the same reader as a real session, with the folder placeholder filled in.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSession, snapshot } from '../src/main/transcript/session.js'
import { listMemory } from '../src/main/transcript/memory.js'

const DEMO = join(__dirname, '..', 'manual', 'demo')
const ID = '00000000-0000-4000-8000-00000000de30'

function demo() {
  const lines = readFileSync(join(DEMO, 'session.jsonl'), 'utf8').replaceAll('__DEMO__', DEMO).trim().split('\n')
  const { state, apply } = createSession(ID)
  for (const l of lines) apply(JSON.parse(l))
  return snapshot(state)
}

describe('the demo session', () => {
  const v = demo()
  it('reads every record, none unknown or damaged', () => {
    expect(v.drift.unknown).toEqual([])
    expect(v.drift.bad).toBe(0)
    expect(v.facts.title).toBe('Demo: a CSV parser')
  })
  it('has a plan with the last step in progress', () => {
    expect(v.plan.items.map((i) => i.status)).toEqual(['completed', 'completed', 'completed', 'in_progress'])
  })
  it('has work running, a subagent with its report, a wake-up and a compaction', () => {
    expect(v.waiting.map((w) => w.id)).toEqual(['b-demo-2'])
    expect(v.subagents[0]).toMatchObject({ agentId: 'a-demo-1', status: 'finished', tokens: 18240, toolCalls: 9 })
    expect(v.wakeups).toHaveLength(1)
    const items = v.turns.flatMap((t) => t.items)
    expect(items.find((i) => i.type === 'compaction')).toMatchObject({ trigger: 'auto', preTokens: 180000 })
    expect(items.find((i) => i.type === 'compaction').summary).toMatch(/^Summary:/)
  })
  it('is at work, with an earlier question and a file sent to the person', () => {
    expect(v.lastWord.working).toBe(true)
    expect(v.turns.some((t) => t.ask === 'Shall I run the tests now?')).toBe(true)
    expect(v.deliveries[0].files[0]).toBe(join(DEMO, 'csv-parser', 'samples', 'edge-cases.csv'))
  })
  it('has a memory note the reader lists', async () => {
    const m = await listMemory(join(DEMO, 'memory'))
    expect(m.notes.map((n) => n.name)).toEqual(['csv-quirks'])
  })
  it('starts its board from a request of shapes', () => {
    const req = JSON.parse(readFileSync(join(DEMO, 'boards', `${ID}.request.json`), 'utf8'))
    expect(req.add.filter((a) => a.kind !== 'arrow').map((a) => a.id)).toEqual(['reader', 'parser', 'tests'])
  })
})
