// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The manual (R18): its lessons read as the player needs, the demo's copy is
// filled in and brought up to date, and every element a lesson names exists
// in the interface (R18.11).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cleanLesson, listLessons, rebase } from '../src/main/manual.js'
import { stepMs, matches } from '../src/renderer/src/manual.js'

const ROOT = join(__dirname, '..')
const MANUAL = join(ROOT, 'manual')

describe('a lesson file', () => {
  it('is read with its steps, and refused without a number, title or steps', () => {
    const l = cleanLesson({ n: 3, title: 'T', panels: ['panel-now'], steps: [{ target: 'hold', action: 'click', caption: 'c' }, { target: ['a', 'b'], action: 'odd', caption: 'd', try: true }] })
    expect(l.steps).toEqual([
      { target: ['hold'], action: 'click', text: null, caption: 'c', try: false },
      { target: ['a', 'b'], action: 'point', text: null, caption: 'd', try: true },
    ])
    expect(cleanLesson({ title: 'T', steps: [{ caption: 'c' }] })).toBeNull()
    expect(cleanLesson({ n: 1, title: 'T', steps: [] })).toBeNull()
  })
  it('is listed in order, and left out on a system it does not name', async () => {
    const all = await listLessons(MANUAL, 'darwin')
    expect(all.map((l) => l.n)).toEqual([...all.map((l) => l.n)].sort((a, b) => a - b))
    expect(all.length).toBeGreaterThan(0)
  })
})

describe('the demo copy', () => {
  it('fills in its folder and moves its times so the last record is a minute old', () => {
    const text = ['{"cwd":"__DEMO__/x","timestamp":"2026-01-01T09:00:00.000Z"}', '{"timestamp":"2026-01-01T09:10:00.000Z"}', '{"type":"custom-title"}'].join('\n')
    const now = Date.parse('2026-11-15T12:00:00.000Z')
    const out = rebase(text, '/copy', now).trim().split('\n').map((l) => JSON.parse(l))
    expect(out[0].cwd).toBe('/copy/x')
    expect(out[0].timestamp).toBe('2026-11-15T11:49:00.000Z')
    expect(out[1].timestamp).toBe('2026-11-15T11:59:00.000Z')
    expect(out[2]).toEqual({ type: 'custom-title' })
  })
})

describe('the player', () => {
  it('holds a step for its voice or its caption, whichever is longer', () => {
    expect(stepMs('short')).toBe(1600)
    expect(stepMs('x'.repeat(100))).toBe(5500)
    expect(stepMs('short', 4000)).toBe(4000)
  })
  it('finds a lesson by every word typed, in its title or captions', () => {
    const l = { title: 'Pause the agent with Hold', steps: [{ caption: 'Press it again to release it' }] }
    expect(matches(l, 'pause hold')).toBe(true)
    expect(matches(l, 'release')).toBe(true)
    expect(matches(l, 'pause board')).toBe(false)
  })
})

// Every data-ui name a lesson uses, against the names the interface sets: in
// the HTML, in code (ui(…, 'name') and dataset.ui = 'name'), and the menus'
// names made from their labels (menu-<label>, board-menu-<label>).
describe('every element a lesson names', () => {
  const sources = ['session.html', 'settings.html', 'src/session.js', 'src/board.js', 'src/sessions-panel.js', 'src/manual.js'].map((f) => readFileSync(join(ROOT, 'src', 'renderer', f), 'utf8')).join('\n')
  const named = new Set([...sources.matchAll(/data-ui="([^"]+)"|dataset\.ui = '([^']+)'|ui\([^;]*?, '([a-z0-9-]+)'\)/g)].map((m) => m[1] ?? m[2] ?? m[3]))
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const labels = new Set([...sources.matchAll(/\['([^']+)', \(\)/g)].map((m) => slug(m[1])))
  const exists = (name) => named.has(name) || (name.startsWith('menu-') && labels.has(name.slice(5))) || (name.startsWith('board-menu-') && labels.has(name.slice(11)))
  for (const f of readdirSync(join(MANUAL, 'lessons'))) {
    const l = cleanLesson(JSON.parse(readFileSync(join(MANUAL, 'lessons', f), 'utf8')))
    it(`exists for lesson ${f}`, () => {
      expect(l).not.toBeNull()
      const missing = [...new Set([...l.panels, ...l.steps.flatMap((s) => s.target)])].filter((n) => !exists(n))
      expect(missing).toEqual([])
    })
  }
})
