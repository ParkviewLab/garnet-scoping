// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe as describeName, lessonsFor } from '../src/renderer/src/whats-this.js'

const ROOT = join(__dirname, '..')
const texts = JSON.parse(readFileSync(join(ROOT, 'manual', 'whats-this.json'), 'utf8'))

describe('describe', () => {
  it('gives a name its own entry, else its prefix entry', () => {
    expect(describeName('hold', texts).title).toBe('Hold')
    expect(describeName('lessons-pane-desk', texts).title).toBe('Lessons')
    expect(describeName('board-menu-add-question', texts).title).toBe('Board menu item')
    expect(describeName('no-such-name', texts)).toBeNull()
  })
})

describe('lessonsFor', () => {
  const lessons = [
    { n: 1, panels: ['pane-desk'], steps: [{ target: ['hold'] }] },
    { n: 2, panels: ['pane-desk'], steps: [{ target: ['panel-now'] }] },
  ]
  it('takes the lessons that act on the element', () => {
    expect(lessonsFor('hold', null, lessons)).toEqual({ lessons: [lessons[0]], ofPanel: false })
  })
  it("falls back to the panel's lessons", () => {
    expect(lessonsFor('panel-plan', 'pane-desk', lessons)).toEqual({ lessons, ofPanel: true })
    expect(lessonsFor('panel-plan', null, lessons)).toEqual({ lessons: [], ofPanel: true })
  })
})

// R21.5: every name the interface sets has a description, so that no card is
// blank. The names are found as the manual's check finds them (R18.11).
describe('every named element', () => {
  const sources = ['session.html', 'settings.html', 'src/session.js', 'src/board.js', 'src/sessions-panel.js', 'src/manual.js'].map((f) => readFileSync(join(ROOT, 'src', 'renderer', f), 'utf8')).join('\n')
  const named = new Set([...sources.matchAll(/data-ui="([^"]+)"|dataset\.ui = '([^']+)'|ui\([^;]*?, '([a-z0-9-]+)'\)/g)].map((m) => m[1] ?? m[2] ?? m[3]))
  for (const m of sources.matchAll(/data-ui: ([a-z0-9, -]+)/g)) for (const n of m[1].split(',')) named.add(n.trim())
  it('has a description', () => {
    const missing = [...named].filter((n) => /^[a-z0-9-]+$/.test(n) && !describeName(n, texts))
    expect(missing).toEqual([])
  })
  // Each says what the element is called, what it is, and what it is for.
  it('has a name, an explanation and a purpose', () => {
    const entries = [...Object.entries(texts.names), ...Object.entries(texts.prefixes)]
    const short = entries.filter(([, e]) => !Array.isArray(e) || e.length !== 3 || e.some((s) => typeof s !== 'string' || s.trim().length < 3)).map(([k]) => k)
    expect(short).toEqual([])
  })
})
